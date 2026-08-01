import { buildLuts, applyAdjustments, isDefaultAdjust } from './adjust.js'

// Alignment offsets: shift each frame so its selected point lands where the
// center frame's point is. Offsets are in source pixels, relative to the frame.
export function alignmentOffsets(points) {
  if (!points || points.some((p) => !p)) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
  const ref = points[1]
  return points.map((p) => ({ x: ref.x - p.x, y: ref.y - p.y }))
}

// Render the three composited animation frames.
// Output canvas space = the center frame's rect (scaled), optionally cropped.
// crop is in that same space (source pixels, origin at frame top-left).
export function composeFrames({ bitmap, frameRects, points, adjust, match, scale, crop }) {
  const refRect = frameRects[1]
  const cropRect = crop || { x: 0, y: 0, w: refRect.w, h: refRect.h }
  const outW = Math.max(2, Math.round(cropRect.w * scale) & ~1)
  const outH = Math.max(2, Math.round(cropRect.h * scale) & ~1)
  const offsets = alignmentOffsets(points)

  const canvases = []
  for (let i = 0; i < 3; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, outW, outH)
    const r = frameRects[i]
    ctx.drawImage(
      bitmap,
      r.x, r.y, r.w, r.h,
      (offsets[i].x - cropRect.x) * scale,
      (offsets[i].y - cropRect.y) * scale,
      r.w * scale,
      r.h * scale
    )

    const frameAdj = adjust.frames[i]
    const globalAdj = adjust.global
    const frameMatch = adjust.matchEnabled ? match?.[i] : null
    const needsWork = frameMatch || !isDefaultAdjust(frameAdj) || !isDefaultAdjust(globalAdj)
    if (needsWork) {
      const luts = buildLuts(frameAdj, globalAdj, frameMatch)
      const imageData = ctx.getImageData(0, 0, outW, outH)
      applyAdjustments(imageData, luts, frameAdj.saturation * globalAdj.saturation)
      ctx.putImageData(imageData, 0, 0)
    }
    canvases.push(canvas)
  }
  return canvases
}

// Intersection of the three shifted frames in composite space — the region
// covered by all three after alignment. Used by "auto-crop to overlap".
export function overlapRect(frameRects, points, vignetteInset = 0.06) {
  const offsets = alignmentOffsets(points)
  let x0 = -Infinity
  let y0 = -Infinity
  let x1 = Infinity
  let y1 = Infinity
  for (let i = 0; i < 3; i++) {
    const r = frameRects[i]
    // inset each frame a bit to trim the darkest vignette edge
    const ix = r.w * vignetteInset
    const iy = r.h * vignetteInset
    x0 = Math.max(x0, offsets[i].x + ix)
    y0 = Math.max(y0, offsets[i].y + iy)
    x1 = Math.min(x1, offsets[i].x + r.w - ix)
    y1 = Math.min(y1, offsets[i].y + r.h - iy)
  }
  if (x1 <= x0 || y1 <= y0) return null
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }
}

// Ping-pong sequence with per-frame durations (ms): L, C, R, C
export function buildSequence(timing) {
  const s = timing.speed
  return [
    { frame: 0, duration: timing.perFrame[0] * s },
    { frame: 1, duration: timing.perFrame[1] * s },
    { frame: 2, duration: timing.perFrame[2] * s },
    { frame: 1, duration: timing.perFrame[1] * s },
  ]
}
