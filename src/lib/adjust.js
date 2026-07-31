// Per-frame + global color adjustments, and auto exposure matching.

export const defaultFrameAdjust = () => ({ brightness: 0, contrast: 0, saturation: 1 })
export const defaultGlobalAdjust = () => ({ brightness: 0, contrast: 0, saturation: 1 })

// Build one 256-entry LUT per channel combining: match gain/offset (per channel),
// per-frame brightness/contrast, then global brightness/contrast.
export function buildLuts(frameAdj, globalAdj, match) {
  const kf = contrastK(frameAdj.contrast)
  const kg = contrastK(globalAdj.contrast)
  const luts = []
  for (let c = 0; c < 3; c++) {
    const gain = match ? match.gain[c] : 1
    const offset = match ? match.offset[c] : 0
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      let x = gain * v + offset
      x = (x - 128) * kf + 128 + frameAdj.brightness
      x = (x - 128) * kg + 128 + globalAdj.brightness
      lut[v] = x
    }
    luts.push(lut)
  }
  return luts
}

function contrastK(c) {
  // c in [-100, 100] → multiplier in [~0.33, 3]
  return c >= 0 ? 1 + c / 50 : 1 / (1 - c / 50)
}

// Apply LUTs + saturation in one pass over ImageData.
export function applyAdjustments(imageData, luts, saturation) {
  const d = imageData.data
  const [lr, lg, lb] = luts
  const satNeutral = Math.abs(saturation - 1) < 0.001
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]]
    let g = lg[d[i + 1]]
    let b = lb[d[i + 2]]
    if (!satNeutral) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114
      r = gray + (r - gray) * saturation
      g = gray + (g - gray) * saturation
      b = gray + (b - gray) * saturation
    }
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
}

// Sample per-channel mean/std of the central region of a frame (avoids vignette).
function frameStats(bitmap, rect) {
  const w = 200
  const h = 200
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // central 50% box of the frame
  ctx.drawImage(
    bitmap,
    rect.x + rect.w * 0.25, rect.y + rect.h * 0.25, rect.w * 0.5, rect.h * 0.5,
    0, 0, w, h
  )
  const d = ctx.getImageData(0, 0, w, h).data
  const mean = [0, 0, 0]
  const n = w * h
  for (let i = 0; i < d.length; i += 4) {
    mean[0] += d[i]
    mean[1] += d[i + 1]
    mean[2] += d[i + 2]
  }
  for (let c = 0; c < 3; c++) mean[c] /= n
  const varr = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) {
    varr[0] += (d[i] - mean[0]) ** 2
    varr[1] += (d[i + 1] - mean[1]) ** 2
    varr[2] += (d[i + 2] - mean[2]) ** 2
  }
  const std = varr.map((v) => Math.sqrt(v / n))
  return { mean, std }
}

// Compute gain/offset for outer frames so their center-region statistics match
// the center frame's. Returns [matchL, null, matchR] (center is the reference).
export function computeExposureMatch(bitmap, frameRects) {
  const ref = frameStats(bitmap, frameRects[1])
  const result = [null, null, null]
  for (const i of [0, 2]) {
    const s = frameStats(bitmap, frameRects[i])
    const gain = []
    const offset = []
    for (let c = 0; c < 3; c++) {
      let g = s.std[c] > 1 ? ref.std[c] / s.std[c] : 1
      g = Math.min(1.6, Math.max(0.6, g))
      gain.push(g)
      offset.push(ref.mean[c] - g * s.mean[c])
    }
    result[i] = { gain, offset }
  }
  return result
}
