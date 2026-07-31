# Wigglegram Editor

A browser-based editor for photos from a 3-lens wigglegram lens (three side-by-side frames in
one JPEG). Everything runs client-side — photos never leave your machine.

Inspired by [m1kx/3d-image-frontend](https://github.com/m1kx/3d-image-frontend).

## Workflow

1. **Open a photo** — drop the triptych JPEG straight off the camera (or click "Try the example").
2. **Align** — click the same anchor point in each of the three frames (drag to fine-tune with the
   magnifier loupe). That point becomes the pivot the wiggle rotates around.
3. **Preview** — a ping-pong loop (left → center → right → center) with a master speed slider and
   per-frame durations.
4. **Adjust** — "Auto-match frames" evens out exposure/color differences between the three lenses
   (outer frames are matched to the center frame's statistics); per-frame and global
   brightness/contrast/saturation sliders for fine-tuning.
5. **Crop** — off by default (keeps the vignette and moving frame edges as part of the look);
   "Auto-crop to overlap" trims to the area covered by all three frames, and the crop box is
   draggable/resizable on the preview.
6. **Export** — GIF, MP4 (H.264 via WebCodecs, choose loop length), animated WebP, or the three
   aligned still frames. Max-size options from 480 to 1440 px.

Frame splitting defaults to fixed thirds; an auto-detect mode finds the dark separator bands
instead, if you want to compare.

Timing, export, and split-mode settings are remembered in the browser between visits.

## Development

```
npm install
npm run dev
```

## Deploying

Pushing to `main` on GitHub deploys automatically to GitHub Pages via
`.github/workflows/deploy.yml` (enable Pages → "GitHub Actions" as the source in the repo
settings once).
