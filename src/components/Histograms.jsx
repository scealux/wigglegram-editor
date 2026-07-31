import React, { useEffect, useRef } from 'react'

const BINS = 64
const LABELS = ['Left', 'Center', 'Right']

// RGB histogram of a composed preview frame. Near-black pixels are skipped so
// the composited background/vignette doesn't swamp the left edge.
function computeHistogram(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const hist = [new Float64Array(BINS), new Float64Array(BINS), new Float64Array(BINS)]
  const stride = 4 * 4 // sample every 4th pixel
  for (let i = 0; i < data.length; i += stride) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r < 5 && g < 5 && b < 5) continue
    hist[0][(r * BINS) >> 8]++
    hist[1][(g * BINS) >> 8]++
    hist[2][(b * BINS) >> 8]++
  }
  return hist
}

function drawHistogram(canvas, hist) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#111114'
  ctx.fillRect(0, 0, w, h)
  let max = 0
  for (const ch of hist) for (let i = 1; i < BINS - 1; i++) max = Math.max(max, ch[i])
  if (!max) return
  const colors = ['rgba(255,80,80,0.9)', 'rgba(80,220,80,0.9)', 'rgba(90,140,255,0.9)']
  ctx.globalCompositeOperation = 'screen'
  hist.forEach((ch, ci) => {
    ctx.fillStyle = colors[ci]
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < BINS; i++) {
      const v = Math.min(1, ch[i] / max)
      ctx.lineTo((i / (BINS - 1)) * w, h - v * (h - 2))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

export default function Histograms({ frames, selected, onSelect }) {
  const refs = [useRef(null), useRef(null), useRef(null)]

  useEffect(() => {
    if (!frames) return
    frames.forEach((frame, i) => {
      const canvas = refs[i].current
      if (canvas) drawHistogram(canvas, computeHistogram(frame))
    })
  }, [frames])

  if (!frames) return null
  return (
    <div className="hist-row">
      {LABELS.map((label, i) => (
        <div
          key={i}
          className={`hist-cell ${selected === i ? 'selected' : ''}`}
          onClick={() => onSelect(i)}
          title={`${label} frame histogram — click to edit this frame`}
        >
          <canvas ref={refs[i]} width={88} height={52} />
          <div className="hist-label">{label}</div>
        </div>
      ))}
    </div>
  )
}
