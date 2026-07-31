import React, { useEffect, useRef, useState } from 'react'

const LABELS = ['Left', 'Center', 'Right']
const DISPLAY_H = 1300 // canvas pixel height (CSS scales it down)

function FramePanel({ bitmap, rect, point, onSetPoint, label }) {
  const canvasRef = useRef(null)
  const [cursor, setCursor] = useState(null) // frame-local source coords while interacting
  const draggingRef = useRef(false)

  const dispScale = DISPLAY_H / rect.h
  const cw = Math.round(rect.w * dispScale)
  const ch = DISPLAY_H

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch)

    const drawCross = (p, color) => {
      const x = p.x * dispScale
      const y = p.y * dispScale
      ctx.strokeStyle = color
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

    if (point) drawCross(point, '#ffb347')

    // Magnifier loupe while interacting
    if (cursor) {
      const SRC = 260 // source px shown in the loupe
      const LOUPE = 300 // loupe size in canvas px
      const x = cursor.x * dispScale
      const y = cursor.y * dispScale
      let lx = x + 30
      let ly = y - LOUPE - 30
      if (lx + LOUPE > cw) lx = x - LOUPE - 30
      if (ly < 0) ly = y + 30
      lx = Math.max(0, Math.min(cw - LOUPE, lx))
      ly = Math.max(0, Math.min(ch - LOUPE, ly))

      ctx.save()
      ctx.beginPath()
      ctx.arc(lx + LOUPE / 2, ly + LOUPE / 2, LOUPE / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#000'
      ctx.fillRect(lx, ly, LOUPE, LOUPE)
      ctx.drawImage(
        bitmap,
        rect.x + cursor.x - SRC / 2, rect.y + cursor.y - SRC / 2, SRC, SRC,
        lx, ly, LOUPE, LOUPE
      )
      // crosshair in loupe center
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
  }, [bitmap, rect.x, rect.y, rect.w, rect.h, point, cursor, cw, ch, dispScale])

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

  return (
    <div className="align-panel">
      <div className={`label ${point ? 'done' : ''}`}>
        {label} {point ? '✓' : '— click your anchor point'}
      </div>
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        onPointerDown={(e) => {
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
      />
    </div>
  )
}

export default function AlignView({ image, frameRects, points, onSetPoint }) {
  return (
    <div className="align-view">
      {frameRects.map((rect, i) => (
        <FramePanel
          key={i}
          bitmap={image.bitmap}
          rect={rect}
          point={points[i]}
          label={LABELS[i]}
          onSetPoint={(p) => onSetPoint(i, p)}
        />
      ))}
    </div>
  )
}
