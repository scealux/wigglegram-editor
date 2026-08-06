import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUp,
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faChevronLeft,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons'
import { buildLuts, applyAdjustments, isDefaultAdjust } from '../lib/adjust.js'
import { useNarrow } from '../lib/useNarrow.js'

const LABELS = ['Left', 'Center', 'Right']
const DISPLAY_H = 1300 // canvas pixel height (CSS scales it down)
const LOUPE = 300 // loupe size in canvas px
const ZOOMS = [1, 2, 4, 8] // loupe px per source px
const STRIP_H = 340 // docked magnifier height in canvas px (mobile)

const hasWork = (p) => !!p.match || !isDefaultAdjust(p.fa) || !isDefaultAdjust(p.ga)

function FramePanel({ bitmap, rect, point, onSetPoint, label, zoom, params, coarse, showPad, dock, hideLabel }) {
  const canvasRef = useRef(null)
  const loupeSrcRef = useRef(null)
  const [cursor, setCursor] = useState(null) // frame-local source coords while dragging
  const [focused, setFocused] = useState(false)
  const [padStep, setPadStep] = useState(1)
  // Panel-resolution copy of the frame with exposure/color adjustments baked in,
  // so the align view shows the same look as the preview.
  const [adjusted, setAdjusted] = useState(null)
  const draggingRef = useRef(false)
  const repeatRef = useRef(null)
  // Latest point, updated synchronously so fast nudge-repeat doesn't read a
  // stale value between React renders.
  const livePointRef = useRef(point)
  useEffect(() => {
    livePointRef.current = point
  }, [point])
  useEffect(() => () => clearInterval(repeatRef.current), [])

  // When the panel is reused for a different frame (mobile prev/next), drop
  // state that belongs to the old frame.
  useEffect(() => {
    setAdjusted(null)
    setCursor(null)
  }, [bitmap, rect.x, rect.y, rect.w, rect.h])

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

  // Loupe anchor: the drag cursor while dragging, else the set point when
  // focused (or always on touch layouts, where there is no hover state).
  const loupeAt = cursor || ((focused || coarse) && point ? point : null)

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

    if (loupeAt && dock) {
      // Docked magnifier: a fixed full-width strip across the top of the
      // photo, so it never jumps around or hides under a thumb.
      const srcW = cw / zoom
      const srcH = STRIP_H / zoom
      if (!loupeSrcRef.current) loupeSrcRef.current = document.createElement('canvas')
      const lc = loupeSrcRef.current
      if (lc.width !== cw || lc.height !== STRIP_H) {
        lc.width = cw
        lc.height = STRIP_H
      }
      const lctx = lc.getContext('2d', { willReadFrequently: true })
      lctx.fillStyle = '#000'
      lctx.fillRect(0, 0, cw, STRIP_H)
      lctx.imageSmoothingEnabled = zoom < 2
      lctx.drawImage(
        bitmap,
        rect.x + loupeAt.x - srcW / 2, rect.y + loupeAt.y - srcH / 2, srcW, srcH,
        0, 0, cw, STRIP_H
      )
      lctx.imageSmoothingEnabled = true
      if (luts) {
        const imageData = lctx.getImageData(0, 0, cw, STRIP_H)
        applyAdjustments(imageData, luts, saturation)
        lctx.putImageData(imageData, 0, 0)
      }
      ctx.drawImage(lc, 0, 0)
      ctx.strokeStyle = '#ffb347'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cw / 2 - 18, STRIP_H / 2)
      ctx.lineTo(cw / 2 + 18, STRIP_H / 2)
      ctx.moveTo(cw / 2, STRIP_H / 2 - 18)
      ctx.lineTo(cw / 2, STRIP_H / 2 + 18)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, STRIP_H + 1)
      ctx.lineTo(cw, STRIP_H + 1)
      ctx.stroke()
    } else if (loupeAt) {
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
      if (!loupeSrcRef.current) loupeSrcRef.current = document.createElement('canvas')
      const lc = loupeSrcRef.current
      if (lc.width !== LOUPE || lc.height !== LOUPE) {
        lc.width = LOUPE
        lc.height = LOUPE
      }
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

  const startRepeat = (dx, dy) => {
    nudge(dx, dy)
    clearInterval(repeatRef.current)
    repeatRef.current = setInterval(() => nudge(dx, dy), 100)
  }
  const stopRepeat = () => clearInterval(repeatRef.current)

  const padButton = (icon, dx, dy, key) => (
    <button
      key={key}
      className="pad-btn"
      disabled={!point}
      onPointerDown={(e) => {
        e.preventDefault()
        startRepeat(dx * padStep, dy * padStep)
      }}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
      onContextMenu={(e) => e.preventDefault()}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  )

  return (
    <div className="align-panel">
      {!hideLabel && (
        <div className={`label ${point ? 'done' : ''}`}>
          {label} {point ? '✓' : coarse ? '— tap your anchor point' : '— click your anchor point'}
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.focus()
          if (dock && loupeAt) {
            // Taps on the docked magnifier strip must not move the point.
            const r = e.currentTarget.getBoundingClientRect()
            const canvasY = (e.clientY - r.top) * (ch / r.height)
            if (canvasY < STRIP_H) return
          }
          const p = toFrameCoords(e)
          if (coarse || e.pointerType === 'touch') {
            // Touch: place on tap only — dragging or lifting the thumb must
            // not smear the point. Fine-tuning happens on the nudge pad.
            onSetPoint(p)
            setCursor(p)
            return
          }
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
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
      {showPad && (
        <div className="nudge-pad">
          <div className="pad-grid">
            <span />
            {padButton(faArrowUp, 0, -1, 'up')}
            <span />
            {padButton(faArrowLeft, -1, 0, 'left')}
            {padButton(faArrowDown, 0, 1, 'down')}
            {padButton(faArrowRight, 1, 0, 'right')}
          </div>
          <button
            className={`pad-step ${padStep === 10 ? 'toggled' : ''}`}
            onClick={() => setPadStep((s) => (s === 1 ? 10 : 1))}
            title="Toggle nudge step size"
          >
            ×10
          </button>
        </div>
      )}
    </div>
  )
}

export default function AlignView({ image, frameRects, points, onSetPoint, adjust, match }) {
  const [zoom, setZoom] = useState(2)
  const [mobileFrame, setMobileFrame] = useState(0)
  const narrow = useNarrow()
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  useEffect(() => {
    setMobileFrame(0)
  }, [image])

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

  const showPad = coarse || narrow

  if (!narrow) {
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
            {coarse
              ? 'Tap to place the point, then fine-tune with the arrows.'
              : 'After clicking, use arrow keys to nudge the point pixel by pixel (Shift = 10 px).'}
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
              coarse={coarse}
              showPad={showPad}
              onSetPoint={(p) => onSetPoint(i, p)}
            />
          ))}
        </div>
      </div>
    )
  }

  // Narrow layout: one frame at a time. The portrait frame leaves horizontal
  // room, so frame selection and zoom live in a rail beside the photo instead
  // of stacking above it — the photo starts higher and more of the screen is
  // left for the settings below.
  return (
    <div className="align-outer">
      <div className="align-mobile-row">
        <FramePanel
          bitmap={image.bitmap}
          rect={frameRects[mobileFrame]}
          point={points[mobileFrame]}
          label={LABELS[mobileFrame]}
          zoom={zoom}
          params={perFrame[mobileFrame]}
          coarse={coarse}
          showPad
          dock
          hideLabel
          onSetPoint={(p) => onSetPoint(mobileFrame, p)}
        />
        <div className="side-rail">
          <div className="seg-vert">
            {LABELS.map((label, i) => (
              <button
                key={i}
                className={mobileFrame === i ? 'toggled' : ''}
                onClick={() => setMobileFrame(i)}
              >
                {label}
                {points[i] ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <div className="seg-vert">
            {ZOOMS.map((z) => (
              <button key={z} className={zoom === z ? 'toggled' : ''} onClick={() => setZoom(z)}>
                {z}×
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="frame-nav">
        <button disabled={mobileFrame === 0} onClick={() => setMobileFrame((f) => f - 1)}>
          <FontAwesomeIcon icon={faChevronLeft} /> {mobileFrame > 0 ? LABELS[mobileFrame - 1] : ''}
        </button>
        <button disabled={mobileFrame === 2} onClick={() => setMobileFrame((f) => f + 1)}>
          {mobileFrame < 2 ? LABELS[mobileFrame + 1] : ''} <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>
    </div>
  )
}
