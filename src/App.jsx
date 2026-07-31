import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AlignView from './components/AlignView.jsx'
import PreviewPlayer from './components/PreviewPlayer.jsx'
import Histograms from './components/Histograms.jsx'
import { splitThirds, detectBoundaries, splitAtBoundaries } from './lib/frames.js'
import { defaultFrameAdjust, defaultGlobalAdjust, computeExposureMatch } from './lib/adjust.js'
import { composeFrames, overlapRect, buildSequence } from './lib/compose.js'
import { exportGif, exportMp4, exportWebp, exportStills, mp4Supported, webpSupported } from './lib/exporters.js'
import { loadSettings, saveSettings } from './lib/settings.js'

const PREVIEW_MAX = 1100
const FRAME_LABELS = ['Left', 'Center', 'Right']

const saved = loadSettings()

export default function App() {
  const [image, setImage] = useState(null)
  const [splitMode, setSplitMode] = useState(saved.splitMode || 'thirds')
  const [autoBounds, setAutoBounds] = useState(null)
  const [points, setPoints] = useState([null, null, null])
  const [tab, setTab] = useState('align')
  const [playing, setPlaying] = useState(true)
  const [timing, setTiming] = useState(saved.timing || { speed: 1, perFrame: [90, 90, 90] })
  const [adjust, setAdjust] = useState({
    frames: [defaultFrameAdjust(), defaultFrameAdjust(), defaultFrameAdjust()],
    global: defaultGlobalAdjust(),
    matchEnabled: false,
  })
  const [match, setMatch] = useState(null)
  const [adjFrameSel, setAdjFrameSel] = useState(0)
  const [crop, setCrop] = useState({ enabled: false, rect: null })
  const [exportOpts, setExportOpts] = useState(saved.exportOpts || { size: 720, mp4Duration: 4 })
  const [previewFrames, setPreviewFrames] = useState(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [busy, setBusy] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [canMp4] = useState(mp4Supported())
  const [canWebp, setCanWebp] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    webpSupported().then(setCanWebp)
  }, [])

  useEffect(() => {
    saveSettings({ splitMode, timing, exportOpts })
  }, [splitMode, timing, exportOpts])

  const frameRects = useMemo(() => {
    if (!image) return null
    if (splitMode === 'auto' && autoBounds) {
      return splitAtBoundaries(image.width, image.height, autoBounds)
    }
    return splitThirds(image.width, image.height)
  }, [image, splitMode, autoBounds])

  // Detect boundaries lazily when auto mode is first used per image
  useEffect(() => {
    if (image && splitMode === 'auto' && !autoBounds) {
      setAutoBounds(detectBoundaries(image.bitmap))
    }
  }, [image, splitMode, autoBounds])

  const loadFile = useCallback(async (file) => {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    setImage({ bitmap, width: bitmap.width, height: bitmap.height, name: file.name || 'photo' })
    setPoints([null, null, null])
    setAutoBounds(null)
    setMatch(null)
    setAdjust((a) => ({ ...a, matchEnabled: false }))
    setCrop({ enabled: false, rect: null })
    setTab('align')
  }, [])

  const loadExample = useCallback(async () => {
    const res = await fetch(import.meta.env.BASE_URL + 'example.jpg')
    const blob = await res.blob()
    await loadFile(new File([blob], 'example.jpg', { type: 'image/jpeg' }))
  }, [loadFile])

  // Debounced preview composition
  useEffect(() => {
    if (!image || !frameRects) return
    const t = setTimeout(() => {
      const ref = frameRects[1]
      const scale = Math.min(1, PREVIEW_MAX / Math.max(ref.w, ref.h))
      const frames = composeFrames({
        bitmap: image.bitmap,
        frameRects,
        points,
        adjust,
        match,
        scale,
        crop: null,
      })
      setPreviewFrames(frames)
      setPreviewScale(scale)
    }, 120)
    return () => clearTimeout(t)
  }, [image, frameRects, points, adjust, match])

  const setPoint = (i, p) => {
    setPoints((prev) => {
      const next = [...prev]
      next[i] = p
      return next
    })
  }

  const sequence = useMemo(() => buildSequence(timing), [timing])

  const toggleAutoMatch = () => {
    if (!adjust.matchEnabled) {
      if (!match) setMatch(computeExposureMatch(image.bitmap, frameRects))
      setAdjust((a) => ({ ...a, matchEnabled: true }))
    } else {
      setAdjust((a) => ({ ...a, matchEnabled: false }))
    }
  }

  const setFrameAdj = (key, value) => {
    setAdjust((a) => {
      const frames = a.frames.map((f, i) => (i === adjFrameSel ? { ...f, [key]: value } : f))
      return { ...a, frames }
    })
  }

  const setGlobalAdj = (key, value) => {
    setAdjust((a) => ({ ...a, global: { ...a.global, [key]: value } }))
  }

  const resetAdjust = () => {
    setAdjust({
      frames: [defaultFrameAdjust(), defaultFrameAdjust(), defaultFrameAdjust()],
      global: defaultGlobalAdjust(),
      matchEnabled: false,
    })
  }

  const autoCrop = () => {
    const r = overlapRect(frameRects, points)
    if (r) setCrop({ enabled: true, rect: r })
  }

  const toggleCrop = () => {
    setCrop((c) => {
      if (c.enabled) return { ...c, enabled: false }
      if (c.rect) return { ...c, enabled: true }
      const ref = frameRects[1]
      const r = overlapRect(frameRects, points) || {
        x: Math.round(ref.w * 0.1),
        y: Math.round(ref.h * 0.1),
        w: Math.round(ref.w * 0.8),
        h: Math.round(ref.h * 0.8),
      }
      return { enabled: true, rect: r }
    })
  }

  const doExport = async (format) => {
    if (busy) return
    setBusy('Rendering frames…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const ref = frameRects[1]
      const cropRect = crop.enabled && crop.rect ? crop.rect : { x: 0, y: 0, w: ref.w, h: ref.h }
      const scale = Math.min(1, exportOpts.size / Math.max(cropRect.w, cropRect.h))
      const canvases = composeFrames({
        bitmap: image.bitmap,
        frameRects,
        points,
        adjust,
        match,
        scale,
        crop: cropRect,
      })
      const baseName = (image.name.replace(/\.[^.]+$/, '') || 'wigglegram') + '-wiggle'
      setBusy(`Encoding ${format.toUpperCase()}…`)
      await new Promise((r) => setTimeout(r, 30))
      if (format === 'gif') await exportGif(canvases, sequence, baseName)
      else if (format === 'mp4') await exportMp4(canvases, sequence, baseName, exportOpts.mp4Duration)
      else if (format === 'webp') await exportWebp(canvases, sequence, baseName)
      else if (format === 'stills') await exportStills(canvases, baseName)
    } catch (err) {
      console.error(err)
      alert(`Export failed: ${err.message || err}`)
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) loadFile(file)
  }

  const pointsComplete = points.every(Boolean)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header>
        <h1>
          Wiggle<span>gram</span> Editor
        </h1>
        {image && (
          <span className="muted">
            {image.name} · {image.width}×{image.height}
          </span>
        )}
        <button onClick={() => fileInputRef.current.click()}>
          {image ? 'New photo' : 'Open photo'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) loadFile(f)
            e.target.value = ''
          }}
        />
      </header>

      {!image ? (
        <div className={`dropzone ${dragOver ? 'drag-over' : ''}`}>
          <div className="big">Drop a wigglegram JPEG here</div>
          <div>
            The triptych straight off your camera — three frames side by side. Everything runs in
            your browser; nothing is uploaded.
          </div>
          <div className="btn-row" style={{ width: 'auto' }}>
            <button className="primary" onClick={() => fileInputRef.current.click()}>
              Choose a photo
            </button>
            <button onClick={loadExample}>Try the example</button>
          </div>
        </div>
      ) : (
        <div className="main">
          <div className="stage">
            <div className="tabs">
              <button className={tab === 'align' ? 'toggled' : ''} onClick={() => setTab('align')}>
                1 · Align
              </button>
              <button
                className={tab === 'preview' ? 'toggled' : ''}
                onClick={() => setTab('preview')}
                disabled={!previewFrames}
              >
                2 · Preview
              </button>
              <span className="hint">
                {tab === 'align'
                  ? 'Click the same point in all three frames — that point becomes the pivot of the wiggle.'
                  : crop.enabled
                    ? 'Drag the crop box or its corners.'
                    : ''}
              </span>
            </div>
            <div className="stage-body">
              {tab === 'align' ? (
                <AlignView image={image} frameRects={frameRects} points={points} onSetPoint={setPoint} />
              ) : (
                previewFrames && (
                  <PreviewPlayer
                    frames={previewFrames}
                    sequence={sequence}
                    playing={playing}
                    onTogglePlay={() => setPlaying((p) => !p)}
                    previewScale={previewScale}
                    crop={crop}
                    onCropChange={(rect) => setCrop((c) => ({ ...c, rect }))}
                  />
                )
              )}
            </div>
          </div>

          <aside className="panel">
            <div className="section">
              <h2>Frames</h2>
              <div className="seg">
                <button
                  className={splitMode === 'thirds' ? 'toggled' : ''}
                  onClick={() => setSplitMode('thirds')}
                >
                  Fixed thirds
                </button>
                <button
                  className={splitMode === 'auto' ? 'toggled' : ''}
                  onClick={() => setSplitMode('auto')}
                >
                  Auto-detect
                </button>
              </div>
              {splitMode === 'auto' && autoBounds && (
                <div className="muted">
                  Detected splits at {autoBounds[0]}px and {autoBounds[1]}px (thirds would be{' '}
                  {Math.round(image.width / 3)}px / {Math.round((image.width * 2) / 3)}px).
                </div>
              )}
              <div className="muted">
                Alignment: {points.filter(Boolean).length}/3 points set
                {pointsComplete ? ' ✓' : ''}
                {points.some(Boolean) && (
                  <>
                    {' · '}
                    <a
                      href="#"
                      style={{ color: 'var(--accent)' }}
                      onClick={(e) => {
                        e.preventDefault()
                        setPoints([null, null, null])
                      }}
                    >
                      clear
                    </a>
                  </>
                )}
              </div>
              {pointsComplete && tab === 'align' && (
                <button className="primary" onClick={() => setTab('preview')}>
                  Preview the wiggle →
                </button>
              )}
            </div>

            <div className="section">
              <h2>Timing</h2>
              <div className="row">
                <label>Speed</label>
                <input
                  type="range"
                  min="0.4"
                  max="2.5"
                  step="0.05"
                  value={timing.speed}
                  onChange={(e) => setTiming({ ...timing, speed: +e.target.value })}
                />
                <span className="val">{timing.speed.toFixed(2)}×</span>
              </div>
              {FRAME_LABELS.map((label, i) => (
                <div className="row" key={i}>
                  <label>{label}</label>
                  <input
                    type="range"
                    min="30"
                    max="400"
                    step="5"
                    value={timing.perFrame[i]}
                    onChange={(e) => {
                      const perFrame = [...timing.perFrame]
                      perFrame[i] = +e.target.value
                      setTiming({ ...timing, perFrame })
                    }}
                  />
                  <span className="val">{timing.perFrame[i]}ms</span>
                </div>
              ))}
              <div className="muted">Ping-pong loop: left → center → right → center.</div>
            </div>

            <div className="section">
              <h2>Exposure & color</h2>
              <button className={adjust.matchEnabled ? 'toggled' : ''} onClick={toggleAutoMatch}>
                {adjust.matchEnabled ? '✓ Auto-match on (click to disable)' : 'Auto-match frames'}
              </button>
              <Histograms frames={previewFrames} selected={adjFrameSel} onSelect={setAdjFrameSel} />
              <div className="seg">
                {FRAME_LABELS.map((label, i) => {
                  const f = adjust.frames[i]
                  const touched =
                    f.brightness !== 0 || f.contrast !== 0 || f.saturation !== 1 ||
                    (adjust.matchEnabled && i !== 1)
                  return (
                    <button
                      key={i}
                      className={adjFrameSel === i ? 'toggled' : ''}
                      onClick={() => setAdjFrameSel(i)}
                    >
                      {label}
                      {touched && <span className="dot" />}
                    </button>
                  )
                })}
              </div>
              <AdjustSliders values={adjust.frames[adjFrameSel]} onChange={setFrameAdj} />
              <h2 style={{ marginTop: 4 }}>All frames</h2>
              <AdjustSliders values={adjust.global} onChange={setGlobalAdj} />
              <button onClick={resetAdjust}>Reset all</button>
            </div>

            <div className="section">
              <h2>Crop</h2>
              <div className="btn-row">
                <button className={crop.enabled ? 'toggled' : ''} onClick={toggleCrop}>
                  {crop.enabled ? 'Crop: on' : 'Crop: off'}
                </button>
                <button onClick={autoCrop} disabled={!pointsComplete}>
                  Auto-crop to overlap
                </button>
              </div>
              <div className="muted">
                Off keeps the full frame with its vignette and moving edges. Auto-crop trims to the
                area covered by all three frames.
              </div>
            </div>

            <div className="section">
              <h2>Export</h2>
              <div className="row">
                <label>Max size</label>
                <select
                  value={exportOpts.size}
                  onChange={(e) => setExportOpts({ ...exportOpts, size: +e.target.value })}
                >
                  <option value="480">480 px</option>
                  <option value="720">720 px</option>
                  <option value="1080">1080 px</option>
                  <option value="1440">1440 px</option>
                </select>
              </div>
              <div className="row">
                <label>MP4 length</label>
                <select
                  value={exportOpts.mp4Duration}
                  onChange={(e) => setExportOpts({ ...exportOpts, mp4Duration: +e.target.value })}
                >
                  <option value="2">2 s</option>
                  <option value="4">4 s</option>
                  <option value="6">6 s</option>
                  <option value="10">10 s</option>
                </select>
              </div>
              <div className="btn-row">
                <button className="primary" disabled={!!busy} onClick={() => doExport('gif')}>
                  GIF
                </button>
                <button className="primary" disabled={!!busy || !canMp4} onClick={() => doExport('mp4')}>
                  MP4
                </button>
              </div>
              <div className="btn-row">
                <button disabled={!!busy || !canWebp} onClick={() => doExport('webp')}>
                  WebP
                </button>
                <button disabled={!!busy} onClick={() => doExport('stills')}>
                  Still frames
                </button>
              </div>
              {!canMp4 && <div className="muted">MP4 needs a browser with WebCodecs (Chrome, Edge, recent Safari).</div>}
            </div>
          </aside>
        </div>
      )}
      {busy && <div className="busy">{busy}</div>}
    </div>
  )
}

function AdjustSliders({ values, onChange }) {
  const rows = [
    { key: 'brightness', label: 'Brightness', min: -60, max: 60, step: 1, def: 0 },
    { key: 'contrast', label: 'Contrast', min: -60, max: 60, step: 1, def: 0 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.02, def: 1 },
  ]
  return (
    <>
      {rows.map(({ key, label, min, max, step, def }) => (
        <div className={`row ${values[key] !== def ? 'changed' : ''}`} key={key}>
          <label>{label}</label>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={values[key]}
            onChange={(e) => onChange(key, +e.target.value)}
          />
          <span className="val">
            {key === 'saturation' ? values[key].toFixed(2) : values[key]}
          </span>
        </div>
      ))}
    </>
  )
}
