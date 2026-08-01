import React, { useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'

const HANDLE = 16 // canvas px

export default function PreviewPlayer({
  frames, // [canvas ×3] at preview scale, uncropped
  sequence, // [{frame, duration}]
  playing,
  onTogglePlay,
  previewScale, // source px → preview canvas px
  crop, // {enabled, rect} — rect in source coords, or null
  onCropChange,
}) {
  const canvasRef = useRef(null)
  const stateRef = useRef({ step: 0, nextAt: 0 })
  const propsRef = useRef({})
  propsRef.current = { frames, sequence, playing, crop, previewScale, onCropChange }
  const dragRef = useRef(null)

  const w = frames[0].width
  const h = frames[0].height

  useEffect(() => {
    let raf
    const tick = (now) => {
      const { frames, sequence, playing, crop, previewScale } = propsRef.current
      const st = stateRef.current
      if (st.nextAt === 0) st.nextAt = now + sequence[st.step].duration
      if (playing && now >= st.nextAt) {
        st.step = (st.step + 1) % sequence.length
        st.nextAt = now + sequence[st.step].duration
      }
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.drawImage(frames[sequence[st.step].frame], 0, 0)
        if (crop.enabled && crop.rect) {
          const s = previewScale
          const r = crop.rect
          const cx = r.x * s
          const cy = r.y * s
          const cw2 = r.w * s
          const ch2 = r.h * s
          ctx.fillStyle = 'rgba(0,0,0,0.55)'
          ctx.fillRect(0, 0, canvas.width, cy)
          ctx.fillRect(0, cy + ch2, canvas.width, canvas.height - cy - ch2)
          ctx.fillRect(0, cy, cx, ch2)
          ctx.fillRect(cx + cw2, cy, canvas.width - cx - cw2, ch2)
          ctx.strokeStyle = '#ffb347'
          ctx.lineWidth = 2
          ctx.strokeRect(cx, cy, cw2, ch2)
          ctx.fillStyle = '#ffb347'
          for (const [hx, hy] of corners(cx, cy, cw2, ch2)) {
            ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toCanvas = (e) => {
    const canvas = canvasRef.current
    const r = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    }
  }

  const onPointerDown = (e) => {
    const { crop, previewScale } = propsRef.current
    if (!crop.enabled || !crop.rect || !onCropChange) return
    const p = toCanvas(e)
    const s = previewScale
    const r = crop.rect
    const cs = corners(r.x * s, r.y * s, r.w * s, r.h * s)
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p.x - cs[i][0]) < HANDLE * 1.6 && Math.abs(p.y - cs[i][1]) < HANDLE * 1.6) {
        dragRef.current = { mode: 'resize', corner: i, start: p, rect: { ...r } }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    if (p.x > r.x * s && p.x < (r.x + r.w) * s && p.y > r.y * s && p.y < (r.y + r.h) * s) {
      dragRef.current = { mode: 'move', start: p, rect: { ...r } }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const { previewScale, onCropChange } = propsRef.current
    const s = previewScale
    const p = toCanvas(e)
    const dx = (p.x - d.start.x) / s
    const dy = (p.y - d.start.y) / s
    const maxW = w / s
    const maxH = h / s
    let r = { ...d.rect }
    if (d.mode === 'move') {
      r.x = clamp(d.rect.x + dx, 0, maxW - r.w)
      r.y = clamp(d.rect.y + dy, 0, maxH - r.h)
    } else {
      // corners: 0 TL, 1 TR, 2 BR, 3 BL
      let x0 = d.rect.x
      let y0 = d.rect.y
      let x1 = d.rect.x + d.rect.w
      let y1 = d.rect.y + d.rect.h
      if (d.corner === 0 || d.corner === 3) x0 = clamp(x0 + dx, 0, x1 - 50)
      else x1 = clamp(x1 + dx, x0 + 50, maxW)
      if (d.corner === 0 || d.corner === 1) y0 = clamp(y0 + dy, 0, y1 - 50)
      else y1 = clamp(y1 + dy, y0 + 50, maxH)
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    onCropChange({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
  }

  return (
    <div className="preview-wrap">
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        style={{ cursor: crop.enabled ? 'move' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragRef.current = null)}
      />
      <div className="player-controls">
        <button onClick={onTogglePlay}>
          <FontAwesomeIcon icon={playing ? faPause : faPlay} /> {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </div>
  )
}

function corners(x, y, w, h) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
