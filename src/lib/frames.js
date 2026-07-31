// Splitting the full triptych JPEG into three sub-frame rects.

// Equal thirds — the default. Keeps the lens offsets/vignette as part of the look.
export function splitThirds(width, height) {
  const w = Math.floor(width / 3)
  return [
    { x: 0, y: 0, w, h: height },
    { x: w, y: 0, w, h: height },
    { x: w * 2, y: 0, w, h: height },
  ]
}

// Auto-detect: find the dark vertical separator bands near 1/3 and 2/3.
// Works on a downscaled luminance profile of the image.
export function detectBoundaries(bitmap) {
  const sampleW = 1400
  const scale = sampleW / bitmap.width
  const sampleH = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = sampleW
  canvas.height = sampleH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH)
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data

  // Mean luminance per column, using the middle 60% of rows to dodge
  // top/bottom vignetting.
  const y0 = Math.floor(sampleH * 0.2)
  const y1 = Math.floor(sampleH * 0.8)
  const colLum = new Float64Array(sampleW)
  for (let x = 0; x < sampleW; x++) {
    let sum = 0
    for (let y = y0; y < y1; y++) {
      const i = (y * sampleW + x) * 4
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    }
    colLum[x] = sum / (y1 - y0)
  }

  // Smooth slightly to avoid single-column noise.
  const smooth = new Float64Array(sampleW)
  const R = 3
  for (let x = 0; x < sampleW; x++) {
    let sum = 0
    let n = 0
    for (let dx = -R; dx <= R; dx++) {
      const xi = x + dx
      if (xi >= 0 && xi < sampleW) {
        sum += colLum[xi]
        n++
      }
    }
    smooth[x] = sum / n
  }

  // Find the darkest column within ±12% of each expected boundary.
  const findMin = (center) => {
    const half = Math.floor(sampleW * 0.12)
    let best = center
    let bestVal = Infinity
    for (let x = center - half; x <= center + half; x++) {
      if (smooth[x] < bestVal) {
        bestVal = smooth[x]
        best = x
      }
    }
    return best
  }

  const b1 = findMin(Math.round(sampleW / 3))
  const b2 = findMin(Math.round((sampleW * 2) / 3))
  return [Math.round(b1 / scale), Math.round(b2 / scale)]
}

export function splitAtBoundaries(width, height, [b1, b2]) {
  return [
    { x: 0, y: 0, w: b1, h: height },
    { x: b1, y: 0, w: b2 - b1, h: height },
    { x: b2, y: 0, w: width - b2, h: height },
  ]
}
