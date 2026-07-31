import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ---------------- GIF ----------------

export async function exportGif(canvases, sequence, baseName) {
  const gif = GIFEncoder()
  const w = canvases[0].width
  const h = canvases[0].height
  for (const step of sequence) {
    const ctx = canvases[step.frame].getContext('2d')
    const { data } = ctx.getImageData(0, 0, w, h)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    // GIF delays are in 10ms units; browsers clamp below ~20ms
    const delay = Math.max(20, Math.round(step.duration / 10) * 10)
    gif.writeFrame(index, w, h, { palette, delay })
    await new Promise((r) => setTimeout(r))
  }
  gif.finish()
  download(new Blob([gif.bytes()], { type: 'image/gif' }), `${baseName}.gif`)
}

// ---------------- MP4 (WebCodecs) ----------------

export function mp4Supported() {
  return typeof window.VideoEncoder === 'function'
}

export async function exportMp4(canvases, sequence, baseName, durationSec) {
  const w = canvases[0].width
  const h = canvases[0].height
  const large = Math.max(w, h) > 1280
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  encoder.configure({
    codec: large ? 'avc1.640028' : 'avc1.42001f',
    width: w,
    height: h,
    bitrate: Math.min(20_000_000, Math.max(2_000_000, Math.round(w * h * 4))),
  })

  let tsUs = 0
  const targetUs = durationSec * 1_000_000
  let frameCount = 0
  outer: while (tsUs < targetUs) {
    for (const step of sequence) {
      if (tsUs >= targetUs) break outer
      const durUs = Math.round(step.duration * 1000)
      const frame = new VideoFrame(canvases[step.frame], { timestamp: tsUs, duration: durUs })
      encoder.encode(frame, { keyFrame: frameCount % 60 === 0 })
      frame.close()
      tsUs += durUs
      frameCount++
      if (frameCount % 20 === 0) await encoder.flush()
    }
  }
  await encoder.flush()
  muxer.finalize()
  download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `${baseName}.mp4`)
}

// ---------------- Animated WebP (manual RIFF muxing) ----------------

export async function webpSupported() {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp'))
  return !!blob && blob.type === 'image/webp'
}

async function encodeWebpFrame(canvas, quality) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality))
  const buf = new Uint8Array(await blob.arrayBuffer())
  // RIFF header is 12 bytes; then chunks. Grab VP8 /VP8L bitstream chunk(s),
  // including ALPH if present (keep everything between header and EOF).
  const chunks = []
  let pos = 12
  while (pos + 8 <= buf.length) {
    const tag = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3])
    const size = buf[pos + 4] | (buf[pos + 5] << 8) | (buf[pos + 6] << 16) | (buf[pos + 7] << 24)
    const padded = size + (size & 1)
    if (tag === 'VP8 ' || tag === 'VP8L' || tag === 'ALPH') {
      chunks.push(buf.slice(pos, pos + 8 + padded))
    }
    pos += 8 + padded
  }
  return chunks
}

function u24(v) {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]
}
function u32(v) {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}
function chunk(tag, payload) {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1))
  out.set([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)])
  out.set(u32(payload.length), 4)
  out.set(payload, 8)
  return out
}

export async function exportWebp(canvases, sequence, baseName, quality = 0.85) {
  const w = canvases[0].width
  const h = canvases[0].height

  const frameChunks = []
  for (const c of canvases) frameChunks.push(await encodeWebpFrame(c, quality))

  const parts = []
  // VP8X: animation flag (bit 1 of byte 0 counting from MSB side: 0x02)
  parts.push(chunk('VP8X', new Uint8Array([0x02, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)])))
  // ANIM: white background, infinite loop
  parts.push(chunk('ANIM', new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0])))
  for (const step of sequence) {
    const inner = frameChunks[step.frame]
    const innerLen = inner.reduce((a, c) => a + c.length, 0)
    const payload = new Uint8Array(16 + innerLen)
    payload.set([...u24(0), ...u24(0), ...u24(w - 1), ...u24(h - 1), ...u24(Math.round(step.duration))])
    payload[15] = 0 // blend, no dispose
    let o = 16
    for (const c of inner) {
      payload.set(c, o)
      o += c.length
    }
    parts.push(chunk('ANMF', payload))
  }

  const bodyLen = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(12 + bodyLen)
  out.set([0x52, 0x49, 0x46, 0x46, ...u32(bodyLen + 4), 0x57, 0x45, 0x42, 0x50])
  let o = 12
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  download(new Blob([out], { type: 'image/webp' }), `${baseName}.webp`)
}

// ---------------- Still frames ----------------

export async function exportStills(canvases, baseName) {
  const names = ['left', 'center', 'right']
  for (let i = 0; i < 3; i++) {
    const blob = await new Promise((r) => canvases[i].toBlob(r, 'image/jpeg', 0.92))
    download(blob, `${baseName}-${names[i]}.jpg`)
    await new Promise((r) => setTimeout(r, 300))
  }
}
