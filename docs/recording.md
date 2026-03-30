# Recording System for Beyond Tellerrand Talk

Record demos of clock quirks as MP4 videos with consistent framing for Keynote.

## Requirements

- Set clock to a specific time, trigger a quirk, record it as MP4
- Fixed window size so all recordings line up in Keynote
- Dev-only: not included in production build
- Hide debug chrome (checkbox, fullscreen button, control panel) during recording
- Debug overlays (horizon line, etc.) stay visible if debug mode is checked

## Architecture

### Dev-only module

Create `src/recorder.js` — imported conditionally in `main.js` behind `import.meta.env.DEV`. This means Vite tree-shakes it out of the production build entirely.

`mp4-muxer` added as a **devDependency** (not bundled in prod).

### Pipeline

```
getDisplayMedia() → MediaStreamTrackProcessor → VideoFrame
    → VideoEncoder (H.264) → mp4-muxer → Blob → download
```

1. `getDisplayMedia({ video: true })` captures the browser tab
2. `MediaStreamTrackProcessor` yields `VideoFrame` objects from the stream
3. `VideoEncoder` encodes each frame to H.264 (`avc1.42001f` baseline or `avc1.4d0028` main)
4. `mp4-muxer` (`Muxer` with `target: ArrayBufferTarget`) collects chunks
5. On stop: finalize muxer, create Blob, trigger download

### Fixed window size

`recorder.js` exposes a `prepareWindow(width, height)` that calls `window.resizeTo()`. Default: 960x960 (square, matches the circular clock, 2x for retina sharpness on a 1080p slide). Configurable via console.

### Hiding debug chrome during recording

When recording starts, add a CSS class `recording` to `<body>`. CSS rules:

```css
body.recording #debug-toggle,
body.recording #fullscreen-toggle,
body.recording #manual-controls {
    display: none !important;
}
```

This hides the debug checkbox, fullscreen button, and control panel. But `#debug-info` and `#horizon-line` keep their existing visibility — so if debug mode is checked before recording, the overlays remain visible in the video.

### Console API

All commands on `window.recorder`:

```js
recorder.setTime(h, m, s)        // Set clock to exact time (via timeOffset)
recorder.prepareWindow(w, h)     // Resize browser window (default 960x960)
recorder.start(durationSeconds)  // Start recording, auto-stop after duration
recorder.stop()                  // Manual stop (also called by auto-stop)
```

Typical workflow:
```js
recorder.prepareWindow()          // resize to 960x960
recorder.setTime(10, 10, 0)      // set to 10:10
recorder.start(5)                 // record 5 seconds
clock.debug.overwind()            // trigger quirk — within the recording
```

Or a combo helper:
```js
recorder.demo('overwind', '10:10:00', 8)
// → sets time, starts 8s recording, triggers the named quirk after 500ms
```

### File output

Downloaded as `badclock-{quirk}-{timestamp}.mp4`, e.g. `badclock-overwind-20260330-141500.mp4`.

## Files to create/modify

| File | Change |
|------|--------|
| `package.json` | Add `mp4-muxer` to `devDependencies` |
| `src/recorder.js` | **New.** WebCodecs recording pipeline, console API |
| `src/main.js` | Conditionally import and initialize recorder in DEV mode |
| `src/clock.js` | Add `debug.setTime(h, m, s)` command |
| `src/debug-panel.css` | Add `body.recording` hide rules |

## Notes

- WebCodecs + `MediaStreamTrackProcessor` require Chrome/Edge. Fine for local recording.
- `window.resizeTo()` only works on windows opened by script, or may be restricted. Alternative: just document the target size and let the user resize manually, or use Chrome's `--window-size` flag.
- If `resizeTo` doesn't work, `prepareWindow()` will log the target dimensions so you can resize DevTools/window manually.
