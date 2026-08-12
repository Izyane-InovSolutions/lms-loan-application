import React, { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'

const LIVENESS_CHALLENGES = [
  'Blink your eyes',
  'Turn your head slightly left, then right',
  'Nod your head',
  'Smile for the camera',
]

const CHALLENGE_WINDOW_MS = 6000
const SAMPLE_INTERVAL_MS = 200
const SAMPLE_SIZE = 48
// Mean per-pixel luminance change (0-255 scale) between two samples required to count as movement.
const MOTION_THRESHOLD = 10

const FACE_DETECT_INTERVAL_MS = 350
const FACE_DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
const MODEL_URL = '/models'

let modelLoadPromise = null
const ensureModelLoaded = () => {
  if (!modelLoadPromise) {
    modelLoadPromise = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
  }
  return modelLoadPromise
}

const pickChallenge = () => LIVENESS_CHALLENGES[Math.floor(Math.random() * LIVENESS_CHALLENGES.length)]

function CameraCaptureModal({ open, onClose, onCapture }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const sampleCanvasRef = useRef(null)
  const previousFrameRef = useRef(null)
  const rafRef = useRef(null)
  const faceIntervalRef = useRef(null)
  const detectingFaceRef = useRef(false)
  const faceDetectedRef = useRef(false)
  const lastSampleTimeRef = useRef(0)
  const challengeDeadlineRef = useRef(0)

  const [error, setError] = useState('')
  const [modelReady, setModelReady] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [challenge, setChallenge] = useState('')
  const [livenessStatus, setLivenessStatus] = useState('pending') // 'pending' | 'verified' | 'timeout'
  const [secondsLeft, setSecondsLeft] = useState(0)

  const startChallenge = () => {
    previousFrameRef.current = null
    lastSampleTimeRef.current = 0
    challengeDeadlineRef.current = Date.now() + CHALLENGE_WINDOW_MS
    setChallenge(pickChallenge())
    setSecondsLeft(Math.ceil(CHALLENGE_WINDOW_MS / 1000))
    setLivenessStatus('pending')
  }

  useEffect(() => {
    if (!open) {
      return undefined
    }

    setError('')
    setModelReady(false)
    setFaceDetected(false)
    faceDetectedRef.current = false
    startChallenge()

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas')
      sampleCanvasRef.current.width = SAMPLE_SIZE
      sampleCanvasRef.current.height = SAMPLE_SIZE
    }

    const motionTick = () => {
      rafRef.current = requestAnimationFrame(motionTick)

      setLivenessStatus((currentStatus) => {
        if (currentStatus === 'verified') {
          return currentStatus
        }

        const now = Date.now()
        if (now > challengeDeadlineRef.current) {
          return 'timeout'
        }
        setSecondsLeft(Math.max(0, Math.ceil((challengeDeadlineRef.current - now) / 1000)))

        if (now - lastSampleTimeRef.current < SAMPLE_INTERVAL_MS) {
          return currentStatus
        }
        lastSampleTimeRef.current = now

        const video = videoRef.current
        const canvas = sampleCanvasRef.current
        if (!video || !canvas || !video.videoWidth) {
          return currentStatus
        }

        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const frame = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const previousFrame = previousFrameRef.current
        previousFrameRef.current = frame

        if (!previousFrame || !faceDetectedRef.current) {
          return currentStatus
        }

        const prev = previousFrame.data
        const curr = frame.data
        let totalDiff = 0
        for (let i = 0; i < curr.length; i += 4) {
          const currLuma = curr[i] + curr[i + 1] + curr[i + 2]
          const prevLuma = prev[i] + prev[i + 1] + prev[i + 2]
          totalDiff += Math.abs(currLuma - prevLuma) / 3
        }
        const meanDiff = totalDiff / (SAMPLE_SIZE * SAMPLE_SIZE)

        return meanDiff > MOTION_THRESHOLD ? 'verified' : currentStatus
      })
    }

    let cancelled = false

    ensureModelLoaded()
      .then(() => {
        if (cancelled) return
        setModelReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setError('Unable to load face detection. Check your connection or upload a file instead.')
      })

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        rafRef.current = requestAnimationFrame(motionTick)

        faceIntervalRef.current = setInterval(async () => {
          if (detectingFaceRef.current) return
          const video = videoRef.current
          if (!video || !video.videoWidth || !modelLoadPromise) return
          detectingFaceRef.current = true
          try {
            await ensureModelLoaded()
            const detection = await faceapi.detectSingleFace(video, FACE_DETECTOR_OPTIONS)
            faceDetectedRef.current = !!detection
            setFaceDetected(!!detection)
          } catch {
            // transient detection errors are ignored; next tick retries
          } finally {
            detectingFaceRef.current = false
          }
        }, FACE_DETECT_INTERVAL_MS)
      })
      .catch(() => {
        if (cancelled) return
        setError('Unable to access the camera. Check permissions or upload a file instead.')
      })

    return () => {
      cancelled = true
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current)
        faceIntervalRef.current = null
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [open])

  if (!open) {
    return null
  }

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (faceIntervalRef.current) {
      clearInterval(faceIntervalRef.current)
      faceIntervalRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const handleClose = () => {
    stopCamera()
    onClose()
  }

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || livenessStatus !== 'verified' || !faceDetectedRef.current) {
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return
        }
        const file = new File([blob], `passport-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        stopCamera()
        onCapture(file)
      },
      'image/jpeg',
      0.92
    )
  }

  const captureDisabled = !!error || livenessStatus !== 'verified' || !faceDetected

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4" onClick={handleClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">Take passport photo</h3>
          <button type="button" className="text-2xl leading-none text-slate-400" onClick={handleClose} aria-label="Close camera">
            ×
          </button>
        </div>

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full rounded-xl bg-slate-900 object-cover" />

            <div className="mt-3 min-h-[2.5rem] rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {!modelReady && (
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                  Loading face detection...
                </span>
              )}
              {modelReady && !faceDetected && (
                <span className="font-semibold text-amber-600">No face detected — please position your face in the frame.</span>
              )}
              {modelReady && faceDetected && livenessStatus === 'verified' && (
                <span className="font-semibold text-emerald-700">Liveness confirmed — you can now capture your photo.</span>
              )}
              {modelReady && faceDetected && livenessStatus === 'pending' && (
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                  {challenge} ({secondsLeft}s)
                </span>
              )}
              {modelReady && faceDetected && livenessStatus === 'timeout' && (
                <span className="font-semibold text-red-600">We couldn't detect any movement. Please try again.</span>
              )}
            </div>
          </>
        )}

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-lg bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
          >
            Cancel
          </button>
          {livenessStatus === 'timeout' && faceDetected ? (
            <button
              type="button"
              onClick={startChallenge}
              className="flex-1 rounded-lg bg-gradient-to-r from-sky-600 to-sky-400 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCapture}
              disabled={captureDisabled}
              className="flex-1 rounded-lg bg-gradient-to-r from-sky-600 to-sky-400 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Capture
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CameraCaptureModal
