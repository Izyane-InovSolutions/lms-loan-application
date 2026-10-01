import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { cn } from '@/lib/utils'

const WIDTH = 600
const HEIGHT = 180
const INK = '#1a2230'
const SCRIPT_FONT = "italic 46px 'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'URW Chancery L', cursive"

/**
 * Where the customer signs: drawn with a finger, pen or mouse, or their typed name set in
 * a handwriting style. Reports `{ method: 'drawn' | 'typed', image }` (a PNG data URL) to
 * `onChange`, or null while there is nothing to sign with. The server stamps the image
 * into the signed documents (api/_lib/signing.js).
 */
export function SignaturePad({ name, onChange, className }) {
  const [mode, setMode] = useState('drawn')
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)

  const context = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx) {
      ctx.lineWidth = 2.6
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = INK
    }
    return ctx
  }, [])

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT }
  }

  const start = (event) => {
    event.preventDefault()
    // Keeps the stroke going if the finger strays off the box; not every browser allows it.
    try {
      canvasRef.current.setPointerCapture?.(event.pointerId)
    } catch {
      // Drawing still works without it.
    }
    drawing.current = true
    const ctx = context()
    const { x, y } = point(event)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A tap leaves a dot.
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
  }

  const moveTo = (event) => {
    if (!drawing.current) return
    const ctx = context()
    const { x, y } = point(event)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    setHasInk(true)
    onChange({ method: 'drawn', image: canvasRef.current.toDataURL('image/png') })
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d').clearRect(0, 0, WIDTH, HEIGHT)
    setHasInk(false)
    onChange(null)
  }

  // Typed: the name, drawn in a handwriting style onto a canvas of the same size.
  useEffect(() => {
    if (mode !== 'typed') return
    const typed = String(name || '').trim()
    if (typed.length < 3) {
      onChange(null)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = INK
    ctx.font = SCRIPT_FONT
    ctx.textBaseline = 'middle'
    let size = 46
    while (ctx.measureText(typed).width > WIDTH - 40 && size > 18) {
      size -= 2
      ctx.font = SCRIPT_FONT.replace('46px', `${size}px`)
    }
    ctx.fillText(typed, 20, HEIGHT / 2)
    onChange({ method: 'typed', image: canvas.toDataURL('image/png') })
  }, [mode, name])

  const switchTo = (next) => {
    if (next === mode) return
    setMode(next)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-0.5 text-sm" role="radiogroup" aria-label="How to sign">
          {[
            ['drawn', 'Draw'],
            ['typed', 'Type'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => switchTo(value)}
              className={cn('rounded-md px-3 py-1 font-medium transition-colors', mode === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'drawn' && hasInk ? (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Eraser className="size-3.5" aria-hidden="true" />
            Clear
          </button>
        ) : null}
      </div>
      {mode === 'drawn' ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            aria-label="Sign here with your finger, pen or mouse"
            role="img"
            onPointerDown={start}
            onPointerMove={moveTo}
            onPointerUp={end}
            onPointerLeave={end}
            className="block aspect-[10/3] w-full touch-none rounded-lg border-2 border-dashed border-input bg-white"
          />
          {!hasInk ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Sign here</p> : null}
          <span className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-muted-foreground/30" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex aspect-[10/3] w-full items-center rounded-lg border-2 border-dashed border-input bg-white px-5">
          <p className="truncate text-4xl text-[#1a2230]" style={{ font: SCRIPT_FONT }}>
            {String(name || '').trim() || <span className="text-sm not-italic text-muted-foreground">Type your full name above</span>}
          </p>
        </div>
      )}
    </div>
  )
}
