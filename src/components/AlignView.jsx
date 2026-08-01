import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildLuts, applyAdjustments } from '../lib/adjust.js'

const LABELS = ['Left', 'Center', 'Right']
const DISPLAY_H = 1300 // canvas pixel height (CSS scales it down)
const LOUPE = 300 // loupe size in canvas px
const ZOOMS = [1, 2, 4] // loupe px per source px

const hasWork = (p) =>
  !!p.match ||
  p.fa.brightness !== 0 || p.fa.contrast !== 0 || p.fa.saturation !== 1 ||
  p.ga.brightness !== 0 || p.ga.contrast !== 0 || p.ga.saturation !== 1

function FramePanel({ bitmap, rect, point, onSetPoint, label, zoom, params }) {
  const canvasRef = useRef(null)
  const loupeSrcRef = useRef(null)
  const [cursor, setCursor] = useState(null) // frame-local source coords while dragging
  const [focused, setFocused] = useState(false)
  // Panel-resolution copy of the frame with exposure/color adjustments baked in,
  // so the align view shows the same look as the preview.
  const [adjusted, setAdjusted] = useState(null)
  const draggingRef = useRef(false)
  // Latest point, updated synchronously so fast key-repeat doesn't read a
  // stale value between React renders.
  const livePointRef = useRef(point)
  useEffect(() => {
    livePointRef.current = point
  }, [point])

  const dispScale = DISPLAY_H / rect.h
  const cw = Math.round(rect.w * dispScale)
  const ch = DISPLAY_H

  const luts = useMemo(() => (hasWork(params) ? buildLuts(params.fa, params.ga, params.match) : null), [params])
  const saturation = params.fa.saturation * params.ga.saturation

  // Rebuild the adjusted panel bitmap when the frame or its adjustments change
  // (debounced — slider drags fire rapidly).
  useEffect(() => {
    const t = setTimeout(() => {
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch)
      if (luts) {
        const imageData = ctx.getImageData(0, 0, cw, ch)
        applyAdjustments(imageData, luts, saturation)
        ctx.putImageData(imageData, 0, 0)
      }
      setAdjusted(c)
    }, 100)
    return () => clearTimeout(t)
  }, [bitmap, rect.x, rect.y, rect.w, rect.h, cw, ch, luts, saturation])

  // Loupe anchor: the drag cursor while dragging, else the set point when focused
  const loupeAt = cursor || (focused && point ? point : null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (adjusted) ctx.drawImage(adjusted, 0, 0)
    else ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch)

    if (point) {
      const x = point.x * dispScale
      const y = point.y * dispScale
      ctx.strokeStyle = '#ffb347'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - 14, y)
      ctx.lineTo(x + 14, y)
      ctx.moveTo(x, y - 14)
      ctx.lineTo(x, y + 14)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (loupeAt) {
      const src = LOUPE / zoom // source px shown in the loupe
      const x = loupeAt.x * dispScale
      const y = loupeAt.y * dispScale
      let lx = x + 30
      let ly = y - LOUPE - 30
      if (lx + LOUPE > cw) lx = x - LOUPE - 30
      if (ly < 0) ly = y + 30
      lx = Math.max(0, Math.min(cw - LOUPE, lx))
      ly = Math.max(0, Math.min(ch - LOUPE, ly))

      // Render the zoomed region (with adjustments) into an offscreen canvas so
      // the pixel pass never touches what's already drawn on the panel.
      if (!loupeSrcRef.current) {
        loupeSrcRef.current = document.createElement('canvas')
        loupeSrcRef.current.width = LOUPE
        loupeSrcRef.current.height = LOUPE
      }
      const lc = loupeSrcRef.current
      const lctx = lc.getContext('2d', { willReadFrequently: true })
      lctx.fillStyle = '#000'
      lctx.fillRect(0, 0, LOUPE, LOUPE)
      lctx.imageSmoothingEnabled = zoom < 2
      lctx.drawImage(
        bitmap,
        rect.x + loupeAt.x - src / 2, rect.y + loupeAt.y - src / 2, src, src,
        0, 0, LOUPE, LOUPE
      )
      lctx.imageSmoothingEnabled = true
      if (luts) {
        const imageData = lctx.getImageData(0, 0, LOUPE, LOUPE)
        applyAdjustments(imageData, luts, saturation)
        lctx.putImageData(imageData, 0, 0)
      }

      ctx.save()
      ctx.beginPath()
      ctx.arc(lx + LOUPE / 2, ly + LOUPE / 2, LOUPE / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(lc, lx, ly)
      ctx.strokeStyle = '#ffb347'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(lx + LOUPE / 2 - 16, ly + LOUPE / 2)
      ctx.lineTo(lx + LOUPE / 2 + 16, ly + LOUPE / 2)
      ctx.moveTo(lx + LOUPE / 2, ly + LOUPE / 2 - 16)
      ctx.lineTo(lx + LOUPE / 2, ly + LOUPE / 2 + 16)
      ctx.stroke()
      ctx.restore()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(lx + LOUPE / 2, ly + LOUPE / 2, LOUPE / 2, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [bitmap, adjusted, rect.x, rect.y, rect.w, rect.h, point, loupeAt, zoom, luts, saturation, cw, ch, dispScale])

  const toFrameCoords = (e) => {
    const canvas = canvasRef.current
    const r = canvas.getBoundingClientRect()
    const x = ((e.clientX - r.left) * (cw / r.width)) / dispScale
    const y = ((e.clientY - r.top) * (ch / r.height)) / dispScale
    return {
      x: Math.max(0, Math.min(rect.w, x)),
      y: Math.max(0, Math.min(rect.h, y)),
    }
  }

  const nudge = (dx, dy) => {
    const p = livePointRef.current
    if (!p) return
    const np = {
      x: Math.max(0, Math.min(rect.w, p.x + dx)),
      y: Math.max(0, Math.min(rect.h, p.y + dy)),
    }
    livePointRef.current = np
    onSetPoint(np)
  }

  return (
    <div className="align-panel">
      <div className={`label ${point ? 'done' : ''}`}>
        {label} {point ? '✓' : '— click your anchor point'}
      </div>
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.focus()
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          const p = toFrameCoords(e)
          setCursor(p)
          onSetPoint(p)
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return
          const p = toFrameCoords(e)
          setCursor(p)
          onSetPoint(p)
        }}
        onPointerUp={() => {
          draggingRef.current = false
          setCursor(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1
          if (e.key === 'ArrowLeft') nudge(-step, 0)
          else if (e.key === 'ArrowRight') nudge(step, 0)
          else if (e.key === 'ArrowUp') nudge(0, -step)
          else if (e.key === 'ArrowDown') nudge(0, step)
          else return
          e.preventDefault()
        }}
      />
    </div>
  )
}

export default function AlignView({ image, frameRects, points, onSetPoint, adjust, match }) {
  const [zoom, setZoom] = useState(2)

  // Stable per-frame adjustment params so point-only re-renders don't rebuild
  // the adjusted panel bitmaps.
  const perFrame = useMemo(
    () =>
      [0, 1, 2].map((i) => ({
        fa: adjust.frames[i],
        ga: adjust.global,
        match: adjust.matchEnabled ? match?.[i] ?? null : null,
      })),
    [adjust, match]
  )

  return (
    <div className="align-outer">
      <div className="align-toolbar">
        <span className="muted">Magnifier zoom</span>
        <div className="seg" style={{ width: 130 }}>
          {ZOOMS.map((z) => (
            <button key={z} className={zoom === z ? 'toggled' : ''} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
        <span className="muted">
          After clicking, use arrow keys to nudge the point pixel by pixel (Shift = 10 px).
        </span>
      </div>
      <div className="align-view">
        {frameRects.map((rect, i) => (
          <FramePanel
            key={i}
            bitmap={image.bitmap}
            rect={rect}
            point={points[i]}
            label={LABELS[i]}
            zoom={zoom}
            params={perFrame[i]}
            onSetPoint={(p) => onSetPoint(i, p)}
          />
        ))}
      </div>
    </div>
  )
}
