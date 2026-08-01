// Per-frame + global color adjustments, and auto exposure matching.

export const defaultFrameAdjust = () => ({ brightness: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0 })
export const defaultGlobalAdjust = () => ({ brightness: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0 })

export const isDefaultAdjust = (a) =>
  a.brightness === 0 && a.contrast === 0 && a.saturation === 1 &&
  !(a.temperature || 0) && !(a.tint || 0)

// Per-channel offset for temperature (warm ↔ cool) and tint (magenta ↔ green).
// Positive temperature warms (R up, B down); positive tint shifts magenta
// (G down, R/B up slightly).
export function channelOffset(adj, c) {
  const t = adj.temperature || 0
  const ti = adj.tint || 0
  const temp = c === 0 ? 0.6 * t : c === 2 ? -0.6 * t : 0
  const tint = c === 1 ? -0.6 * ti : 0.3 * ti
  return temp + tint
}

// Build one 256-entry LUT per channel combining: match gain/offset (per channel),
// per-frame brightness/contrast, then global brightness/contrast.
export function buildLuts(frameAdj, globalAdj, match) {
  const kf = contrastK(frameAdj.contrast)
  const kg = contrastK(globalAdj.contrast)
  const luts = []
  for (let c = 0; c < 3; c++) {
    const gain = match ? match.gain[c] : 1
    const offset = match ? match.offset[c] : 0
    const frameOff = frameAdj.brightness + channelOffset(frameAdj, c)
    const globalOff = globalAdj.brightness + channelOffset(globalAdj, c)
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      let x = gain * v + offset
      x = (x - 128) * kf + 128 + frameOff
      x = (x - 128) * kg + 128 + globalOff
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

// Compute per-channel gain/offset so the other frames' center-region statistics
// match the reference frame's — including the reference's current
// brightness/contrast sliders, so matching targets the look you've dialed in.
// Returns an array of 3 with null at the reference index.
//
// The LUT pipeline applies match first, then each frame's own sliders
// (v → k·(g·v + o − 128) + 128 + b), so gain/offset are solved to land on the
// target *after* that frame's sliders run.
export function computeExposureMatch(bitmap, frameRects, refIndex = 1, frameAdjusts = null) {
  const fa = (i) => frameAdjusts?.[i] ?? { brightness: 0, contrast: 0 }
  const rawStats = frameRects.map((r) => frameStats(bitmap, r))

  const refAdj = fa(refIndex)
  const kRef = contrastK(refAdj.contrast)
  const target = {
    mean: rawStats[refIndex].mean.map(
      (m, c) => kRef * (m - 128) + 128 + refAdj.brightness + channelOffset(refAdj, c)
    ),
    std: rawStats[refIndex].std.map((s) => kRef * s),
  }

  const result = [null, null, null]
  for (let i = 0; i < 3; i++) {
    if (i === refIndex) continue
    const adj = fa(i)
    const k = contrastK(adj.contrast)
    const s = rawStats[i]
    const gain = []
    const offset = []
    for (let c = 0; c < 3; c++) {
      let g = s.std[c] > 1 ? target.std[c] / (k * s.std[c]) : 1
      g = Math.min(2, Math.max(0.5, g))
      gain.push(g)
      offset.push(
        (target.mean[c] - 128 - adj.brightness - channelOffset(adj, c)) / k + 128 - g * s.mean[c]
      )
    }
    result[i] = { gain, offset }
  }
  return result
}
