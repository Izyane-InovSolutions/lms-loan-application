import React, { useEffect, useRef, useState } from 'react'

function CameraCaptureModal({ open, onClose, onCapture }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      return undefined
    }

    setError('')

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      })
      .catch(() => {
        setError('Unable to access the camera. Check permissions or upload a file instead.')
      })

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [open])

  if (!open) {
    return null
  }

  const handleClose = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    onClose()
  }

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
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
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        onCapture(file)
      },
      'image/jpeg',
      0.92
    )
  }

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
          <video ref={videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full rounded-xl bg-slate-900 object-cover" />
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-lg bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={!!error}
            className="flex-1 rounded-lg bg-gradient-to-r from-sky-600 to-sky-400 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  )
}

export default CameraCaptureModal
