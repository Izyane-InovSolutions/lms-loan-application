import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';

const EAR_L      = [36, 37, 38, 39, 40, 41];
const EAR_R      = [42, 43, 44, 45, 46, 47];
const NOSE_TIP   = 30;
const EYE_L_OUT  = 36;
const EYE_R_OUT  = 45;
const MOUTH_L    = 48;
const MOUTH_R    = 54;
const MOUTH_TOP  = 51;
const MOUTH_BOT  = 57;

const MOTION_MAD    = 3;
const MOTION_NEED   = 10;
const FACE_SECS     = 3;
const BLINK_CLOSE   = 0.22;
const BLINK_OPEN    = 0.26;
const TURN_YAW      = 0.15;
const SMILE_MAR     = 0.30;

type PreChallenge = 'turn-left' | 'turn-right' | 'smile';
type Phase = 'loading' | 'no-face' | 'verifying' | 'challenge' | 'hold' | 'blink' | 'captured';

export interface FaceCaptureCameraProps {
  onCapture: (dataUrl: string) => void;
  onCancel:  () => void;
  size?:     'md' | 'sm' | 'xs';
}

const SIZE_MAP = {
  md: { cls: 'w-56', vw: 224, vh: 299 },
  sm: { cls: 'w-48', vw: 192, vh: 256 },
  xs: { cls: 'w-40', vw: 160, vh: 213 },
};

const CHALLENGE_LABEL: Record<PreChallenge, string> = {
  'turn-left':  'Turn your head LEFT',
  'turn-right': 'Turn your head RIGHT',
  smile:        'Give a big smile',
};

function pickChallenge(): PreChallenge {
  const all: PreChallenge[] = ['turn-left', 'turn-right', 'smile'];
  return all[Math.floor(Math.random() * all.length)];
}

function dist(a: faceapi.Point, b: faceapi.Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function earValue(pts: faceapi.Point[], idx: number[]) {
  const p = idx.map(i => pts[i]);
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

export function FaceCaptureCamera({ onCapture, onCancel, size = 'md' }: FaceCaptureCameraProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const captureRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const motionCvs   = useRef<HTMLCanvasElement | null>(null);
  const rafRef      = useRef<number>(0);
  const capturedRef = useRef(false);

  const phaseRef         = useRef<Phase>('loading');
  const prevPx           = useRef<Uint8ClampedArray | null>(null);
  const motionCount      = useRef(0);
  const challengeRef     = useRef<PreChallenge | null>(null);
  const challengeShown   = useRef<number | null>(null);
  const challengeDone    = useRef(false);
  const holdStart        = useRef<number | null>(null);
  const holdDone         = useRef(false);
  const eyesClosed       = useRef(false);
  const faceLostAt       = useRef<number | null>(null);

  const [phase,       setPhase]      = useState<Phase>('loading');
  const [modelsReady, setModelsReady] = useState(false);
  const [motionPct,   setMotionPct]  = useState(0);
  const [holdPct,     setHoldPct]    = useState(0);
  const [challenge,   setChallenge]  = useState<PreChallenge | null>(null);
  const [error,       setError]      = useState('');

  const { cls, vw, vh } = SIZE_MAP[size];

  useEffect(() => {
    let cancelled = false;
    faceapi.nets.tinyFaceDetector.loadFromUri('/models')
      .then(() => faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'))
      .then(() => { if (!cancelled) { phaseRef.current = 'no-face'; setModelsReady(true); setPhase('no-face'); } })
      .catch(() => { if (!cancelled) setError('Failed to load. Please reload.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const mc = document.createElement('canvas');
        mc.width = mc.height = 32;
        motionCvs.current = mc;
      } catch {
        setError('Camera access denied.');
      }
    })();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  const goPhase = useCallback((p: Phase) => {
    if (phaseRef.current === p) return;
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const capturePhoto = useCallback(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    const video = videoRef.current, canvas = captureRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0); ctx.restore();
    streamRef.current?.getTracks().forEach(t => t.stop());
    overlayRef.current?.getContext('2d')
      ?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    phaseRef.current = 'captured';
    setPhase('captured');
    onCapture(canvas.toDataURL('image/png'));
  }, [onCapture]);

  const drawOverlay = useCallback((
    result: faceapi.WithFaceLandmarks<{detection: faceapi.FaceDetection}, faceapi.FaceLandmarks68>,
    video: HTMLVideoElement, ph: Phase
  ) => {
    const canvas = overlayRef.current; if (!canvas) return;
    const cw = canvas.clientWidth || vw, ch = canvas.clientHeight || vh;
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);

    const vAR = video.videoWidth / video.videoHeight, cAR = cw / ch;
    let scale: number, offX: number, offY: number;
    if (vAR > cAR) { scale = ch / video.videoHeight; offX = (video.videoWidth * scale - cw) / 2; offY = 0; }
    else           { scale = cw / video.videoWidth;  offX = 0; offY = (video.videoHeight * scale - ch) / 2; }
    const toX = (x: number) => cw - (x * scale - offX);
    const toY = (y: number) => y * scale - offY;

    const b  = result.detection.box;
    const bx = toX(b.left + b.width), by = toY(b.top);
    const bw = b.width * scale, bh = b.height * scale;
    const arm = Math.min(bw, bh) * 0.25;
    const color = ph === 'verifying' ? '#f59e0b' : '#22c55e';

    ctx.strokeStyle = color; ctx.shadowColor = color;
    ctx.shadowBlur = 12; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ([
      [bx,      by,       1,  1],
      [bx + bw, by,      -1,  1],
      [bx,      by + bh,  1, -1],
      [bx + bw, by + bh, -1, -1],
    ] as [number,number,number,number][]).forEach(([x,y,dx,dy]) => {
      ctx.beginPath(); ctx.moveTo(x+dx*arm,y); ctx.lineTo(x,y); ctx.lineTo(x,y+dy*arm); ctx.stroke();
    });

    ctx.shadowBlur = 4; ctx.fillStyle = color;
    result.landmarks.positions.forEach(pt => {
      ctx.beginPath(); ctx.arc(toX(pt.x), toY(pt.y), 2, 0, Math.PI * 2); ctx.fill();
    });
  }, [vw, vh]);

  const clearOverlay = useCallback(() => {
    const c = overlayRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }, []);

  const checkMotion = useCallback((
    result: faceapi.WithFaceLandmarks<{detection: faceapi.FaceDetection}, faceapi.FaceLandmarks68>,
    video: HTMLVideoElement
  ): boolean => {
    const mc = motionCvs.current; if (!mc) return false;
    const ctx = mc.getContext('2d'); if (!ctx) return false;
    const b = result.detection.box;
    ctx.drawImage(video, b.left, b.top, b.width, b.height, 0, 0, 32, 32);
    const curr = ctx.getImageData(0, 0, 32, 32).data;
    if (prevPx.current) {
      let diff = 0;
      for (let i = 0; i < curr.length; i += 4) {
        diff += Math.abs(curr[i]   - prevPx.current[i]);
        diff += Math.abs(curr[i+1] - prevPx.current[i+1]);
        diff += Math.abs(curr[i+2] - prevPx.current[i+2]);
      }
      if (diff / (32 * 32 * 3) > MOTION_MAD) motionCount.current++;
    }
    prevPx.current = new Uint8ClampedArray(curr);
    setMotionPct(Math.min(100, Math.round((motionCount.current / MOTION_NEED) * 100)));
    return motionCount.current >= MOTION_NEED;
  }, []);

  const checkPreChallenge = useCallback((pts: faceapi.Point[], ch: PreChallenge): boolean => {
    switch (ch) {
      case 'turn-left':
      case 'turn-right': {
        const eyeMidX = (pts[EYE_L_OUT].x + pts[EYE_R_OUT].x) / 2;
        const eyeW    = dist(pts[EYE_L_OUT], pts[EYE_R_OUT]);
        const yaw     = (pts[NOSE_TIP].x - eyeMidX) / (eyeW || 1);
        return ch === 'turn-left' ? yaw > TURN_YAW : yaw < -TURN_YAW;
      }
      case 'smile': {
        const mw  = dist(pts[MOUTH_L], pts[MOUTH_R]);
        const mar = dist(pts[MOUTH_TOP], pts[MOUTH_BOT]) / (mw || 1);
        return mar > SMILE_MAR;
      }
    }
  }, []);

  const runDetection = useCallback(async () => {
    if (capturedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runDetection); return;
    }
    try {
      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks(true);

      if (!result) {
        const now = performance.now();
        if (!faceLostAt.current) faceLostAt.current = now;

        if (now - faceLostAt.current > 600) {
          motionCount.current   = 0;  prevPx.current        = null;
          challengeRef.current  = null; challengeShown.current = null;
          challengeDone.current = false;
          holdStart.current     = null; holdDone.current       = false;
          eyesClosed.current    = false;
          setMotionPct(0); setHoldPct(0); setChallenge(null);
          goPhase('no-face');
          clearOverlay();
        }
      } else {
        faceLostAt.current = null;
        const pts = result.landmarks.positions;
        const now = performance.now();

        const isLive = checkMotion(result, video);
        if (!isLive) {
          goPhase('verifying');
          drawOverlay(result, video, 'verifying');

        } else if (!challengeDone.current) {
          if (!challengeRef.current) {
            const ch = pickChallenge();
            challengeRef.current = ch;
            setChallenge(ch);
          }
          if (!challengeShown.current) challengeShown.current = now;
          goPhase('challenge');
          drawOverlay(result, video, 'challenge');
          const visibleLong = (now - challengeShown.current) >= 800;
          if (visibleLong && checkPreChallenge(pts, challengeRef.current!)) {
            challengeDone.current = true;
          }

        } else if (!holdDone.current) {
          if (!holdStart.current) holdStart.current = now;
          const held = (now - holdStart.current) / 1000;
          setHoldPct(Math.min(100, Math.round((held / FACE_SECS) * 100)));
          goPhase('hold');
          drawOverlay(result, video, 'hold');
          if (held >= FACE_SECS) { holdDone.current = true; eyesClosed.current = false; }

        } else {
          goPhase('blink');
          drawOverlay(result, video, 'blink');
          const avgEar = (earValue(pts, EAR_L) + earValue(pts, EAR_R)) / 2;
          if (!eyesClosed.current && avgEar < BLINK_CLOSE) {
            eyesClosed.current = true;
          } else if (eyesClosed.current && avgEar >= BLINK_OPEN) {
            capturePhoto(); return;
          }
        }
      }
    } catch {}
    if (!capturedRef.current) rafRef.current = requestAnimationFrame(runDetection);
  }, [drawOverlay, clearOverlay, checkMotion, checkPreChallenge, capturePhoto]);

  useEffect(() => {
    if (!modelsReady) return;
    const video = videoRef.current; if (!video) return;
    const start = () => { rafRef.current = requestAnimationFrame(runDetection); };
    video.addEventListener('playing', start);
    if (!video.paused && video.readyState >= 2) start();
    return () => { video.removeEventListener('playing', start); cancelAnimationFrame(rafRef.current); };
  }, [modelsReady, runDetection]);

  const handleCancel = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    onCancel();
  };

  const ovalColor =
    phase === 'verifying'           ? '#f59e0b' :
    phase === 'no-face' || phase === 'loading' ? 'rgba(255,255,255,0.45)' :
    '#22c55e';

  if (error) return (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="text-red-500 text-xs text-center max-w-[200px]">{error}</p>
      <button type="button" onClick={handleCancel}
        className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs">Cancel</button>
    </div>
  );

  const secsLeft = Math.ceil(FACE_SECS - (holdPct / 100) * FACE_SECS);

  const activeStep =
    phase === 'verifying' ? 1 :
    phase === 'challenge' ? 2 :
    phase === 'hold'      ? 3 :
    phase === 'blink'     ? 4 : 0;

  return (
    <div className="flex flex-col items-center gap-3">

      <div className={`relative rounded-2xl overflow-hidden bg-black ${cls}`} style={{ aspectRatio: '3/4' }}>
        <video ref={videoRef} autoPlay playsInline muted
          className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <svg className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
          <ellipse cx={vw/2} cy={vh/2} rx={vw*0.38} ry={vh*0.42} fill="none"
            stroke={ovalColor} strokeWidth="3"
            strokeDasharray={phase === 'no-face' || phase === 'loading' ? '10 6' : 'none'} />
        </svg>
        {phase === 'loading' && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {activeStep > 0 && (
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`rounded-full transition-all duration-300 ${
              s < activeStep  ? 'w-2 h-2 bg-green-500' :
              s === activeStep ? 'w-3 h-3 bg-primary-600 ring-2 ring-primary-200' :
                                 'w-2 h-2 bg-gray-300'
            }`} />
          ))}
        </div>
      )}

      <div style={{ width: vw }} className="min-h-[72px] flex flex-col items-center justify-center gap-2">

        {(phase === 'loading' || phase === 'no-face') && (
          <p className="text-xs text-gray-400 text-center">
            {phase === 'loading' ? 'Starting camera…' : 'Position your face in the oval'}
          </p>
        )}

        {phase === 'verifying' && (
          <>
            <p className="text-sm font-semibold text-amber-600 text-center">Verifying you're live</p>
            <div className="w-full rounded-full overflow-hidden bg-gray-200 h-1.5">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-200"
                style={{ width: `${motionPct}%` }} />
            </div>
            <p className="text-xs text-gray-400">Keep still for a moment…</p>
          </>
        )}

        {phase === 'challenge' && challenge && (
          <p className="text-base font-bold text-primary-700 text-center animate-pulse">
            {CHALLENGE_LABEL[challenge]}
          </p>
        )}

        {phase === 'hold' && (
          <>
            <p className="text-sm font-semibold text-green-700 text-center">
              Hold still — {secsLeft}s
            </p>
            <div className="w-full rounded-full overflow-hidden bg-gray-200 h-1.5">
              <div className="h-full bg-green-500 rounded-full transition-all duration-200"
                style={{ width: `${holdPct}%` }} />
            </div>
          </>
        )}

        {phase === 'blink' && (
          <p className="text-base font-bold text-green-700 text-center animate-pulse">
            Blink your eyes
          </p>
        )}

      </div>

      <div className="flex gap-2">
        {phase === 'blink' && (
          <button type="button" onClick={capturePhoto}
            className="px-4 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700">
            Capture Now
          </button>
        )}
        <button type="button" onClick={handleCancel}
          className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200">
          Cancel
        </button>
      </div>

      <canvas ref={captureRef} className="hidden" />
    </div>
  );
}

export default FaceCaptureCamera;
