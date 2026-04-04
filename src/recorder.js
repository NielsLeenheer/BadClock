/**
 * Dev-only recorder — reparents #clock inside a <canvas layoutsubtree>
 * and uses drawElementImage() to render each frame.
 *
 * Requires: chrome://flags/#canvas-draw-element
 */

const RECORD_SIZE = 960;

export function initRecorder(clockEl, clock) {
    // Check for API support
    if (!('drawElementImage' in CanvasRenderingContext2D.prototype)) {
        console.warn(
            '[recorder] drawElementImage not available.\n' +
            'Enable: chrome://flags/#canvas-draw-element'
        );
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.setAttribute('layoutsubtree', '');
    canvas.width = RECORD_SIZE;
    canvas.height = RECORD_SIZE;

    // Take the clock's place in the body flex layout
    canvas.style.width = '100vmin';
    canvas.style.height = '100vmin';

    // Reparent: insert canvas where clock was, move clock inside
    clockEl.parentNode.insertBefore(canvas, clockEl);
    canvas.appendChild(clockEl);

    // Clock fills the canvas
    clockEl.style.width = '100%';
    clockEl.style.height = '100%';

    const ctx = canvas.getContext('2d');

    // --- Touch indicator (inside clockEl so drawElementImage captures it) ---
    const touchIndicator = document.createElement('div');
    touchIndicator.style.cssText = `
        position: absolute;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.5);
        border: none;
        pointer-events: none;
        transform: translate(-50%, -50%);
        z-index: 9999;
        display: none;
        transition: opacity 0.15s ease-out;
    `;
    clockEl.appendChild(touchIndicator);

    let recording = false;

    function toClockLocal(clientX, clientY) {
        // Use the canvas rect — it's not rotated so gives accurate bounds
        const rect = canvas.getBoundingClientRect();
        // Screen-space offset from center, normalized to -0.5..0.5
        const nx = (clientX - rect.left) / rect.width - 0.5;
        const ny = (clientY - rect.top) / rect.height - 0.5;

        // Counter-rotate by clock's CSS rotation
        const rad = -clock.rotation.rotation * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        return {
            x: (nx * cos - ny * sin + 0.5) * 100,
            y: (nx * sin + ny * cos + 0.5) * 100,
        };
    }

    function showTouch(clientX, clientY) {
        if (!recording) return;
        const pos = toClockLocal(clientX, clientY);
        touchIndicator.style.left = pos.x + '%';
        touchIndicator.style.top = pos.y + '%';
        touchIndicator.style.display = 'block';
        touchIndicator.style.opacity = '1';
    }

    function moveTouch(clientX, clientY) {
        if (!recording) return;
        const pos = toClockLocal(clientX, clientY);
        touchIndicator.style.left = pos.x + '%';
        touchIndicator.style.top = pos.y + '%';
    }

    function hideTouch() {
        touchIndicator.style.opacity = '0';
        setTimeout(() => {
            if (touchIndicator.style.opacity === '0') {
                touchIndicator.style.display = 'none';
            }
        }, 150);
    }

    // Mouse events
    document.addEventListener('mousedown', (e) => showTouch(e.clientX, e.clientY), true);
    document.addEventListener('mousemove', (e) => {
        if (e.buttons > 0) moveTouch(e.clientX, e.clientY);
    }, true);
    document.addEventListener('mouseup', () => hideTouch(), true);

    // Touch events
    document.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        showTouch(t.clientX, t.clientY);
    }, true);
    document.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        moveTouch(t.clientX, t.clientY);
    }, true);
    document.addEventListener('touchend', () => hideTouch(), true);

    // Draw clock to canvas every frame via rAF
    // (paint event / requestPaint not yet implemented in Chrome)
    //
    // drawElementImage captures the element's layout but not its CSS transform,
    // so we apply the clock's rotation on the canvas context manually.
    const half = RECORD_SIZE / 2;
    function drawFrame() {
        ctx.reset();
        const rot = clock.rotation.rotation * (Math.PI / 180);
        ctx.translate(half, half);
        ctx.rotate(rot);
        ctx.translate(-half, -half);
        ctx.drawElementImage(clockEl, 0, 0, RECORD_SIZE, RECORD_SIZE);
        requestAnimationFrame(drawFrame);
    }
    requestAnimationFrame(drawFrame);

    console.log(`[recorder] Canvas wrapper active (${RECORD_SIZE}x${RECORD_SIZE})`);

    // --- Recording state ---
    let encoder = null;
    let muxer = null;
    let frameCount = 0;
    let stopTimer = null;
    let recordingLabel = null;

    async function start(durationSeconds = 5, label = 'clip') {
        if (recording) { console.warn('[recorder] Already recording'); return; }

        recordingLabel = label;

        const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

        const target = new ArrayBufferTarget();
        muxer = new Muxer({
            target,
            video: {
                codec: 'avc',
                width: RECORD_SIZE,
                height: RECORD_SIZE,
            },
            fastStart: 'in-memory',
        });

        encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => console.error('[recorder] Encoder error:', e),
        });

        encoder.configure({
            codec: 'avc1.4d0028',  // H.264 Main profile
            width: RECORD_SIZE,
            height: RECORD_SIZE,
            bitrate: 8_000_000,
            framerate: 60,
        });

        frameCount = 0;
        recording = true;

        // Capture at fixed 60fps using rAF but only encoding when
        // enough time has passed for the next frame
        const FRAME_INTERVAL = 1000 / 60;  // ms per frame
        let firstRafTime = null;
        let nextFrameTime = 0;

        function captureFrame(rafTime) {
            if (!recording) return;

            if (firstRafTime === null) firstRafTime = rafTime;
            const elapsed = rafTime - firstRafTime;

            // Encode frames at fixed 60fps intervals
            while (nextFrameTime <= elapsed) {
                const frame = new VideoFrame(canvas, {
                    timestamp: frameCount * (1_000_000 / 60),  // fixed µs per frame
                });
                encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
                frame.close();
                frameCount++;
                nextFrameTime += FRAME_INTERVAL;
            }

            requestAnimationFrame(captureFrame);
        }
        requestAnimationFrame(captureFrame);

        if (durationSeconds) {
            stopTimer = setTimeout(() => stop(), durationSeconds * 1000);
        }

        console.log(`[recorder] Recording "${label}" (${durationSeconds}s)...`);
    }

    async function stop() {
        if (!recording) return;
        recording = false;
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }

        await encoder.flush();
        encoder.close();
        muxer.finalize();

        const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `badclock-${recordingLabel}.mp4`;
        a.click();
        URL.revokeObjectURL(url);

        console.log(`[recorder] Saved badclock-${recordingLabel}.mp4 — ${frameCount} frames (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);

        encoder = null;
        muxer = null;
        frameCount = 0;
        recordingLabel = null;
    }

    function setTime(h, m, s = 0) {
        const now = new Date();
        const target = new Date(now);
        target.setHours(h, m, s, 0);
        clock.time.value = target - now;
        console.log(`[recorder] Time set to ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }

    // Quirk triggers — maps name to action
    const quirks = {
        overwind:  () => clock.debug.overwind(),
        shake:     () => clock.debug.shake(),
        beans:     () => clock.debug.beans(),
        detachAll: () => clock.debug.detachAll(),
        flicker:   () => clock.debug.flicker(),
        decay:     () => clock.debug.decay(30),
        dst:       () => clock.debug.dst(),
    };

    /**
     * Record a demo: set time, start recording, trigger quirk.
     * @param {string} quirk    — quirk name (overwind, shake, beans, detachAll, flicker, decay, dst)
     * @param {string} time     — "HH:MM" or "HH:MM:SS"
     * @param {number} duration — recording duration in seconds (default 8)
     * @param {number} delay    — ms before triggering quirk (default 500)
     */
    async function demo(quirk, time = '10:10', duration = 8, delay = 500) {
        if (!quirks[quirk]) {
            console.error(`[recorder] Unknown quirk "${quirk}". Available: ${Object.keys(quirks).join(', ')}`);
            return;
        }

        const [h, m, s = 0] = time.split(':').map(Number);
        setTime(h, m, s);

        await start(duration, quirk);
        setTimeout(() => quirks[quirk](), delay);
    }

    window.recorder = { start, stop, setTime, demo };

    console.log(
        '[recorder] Commands:\n' +
        '  recorder.setTime(h, m, s)       — set clock time\n' +
        '  recorder.start(secs, label)     — record with filename label\n' +
        '  recorder.stop()                 — stop early\n' +
        '  recorder.demo(quirk, time, dur) — set time + record + trigger\n' +
        `    quirks: ${Object.keys(quirks).join(', ')}`
    );
}
