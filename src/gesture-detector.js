/**
 * Clock-face gesture detector.
 *
 * Uses a screen-centered square (sized to viewport height) as the
 * coordinate space. Zones counter-rotate with the clock so they
 * stay anchored to the clock face regardless of orientation.
 *
 * Usage:
 *   const gestures = new GestureDetector(() => rotation);
 *   gestures.on('right-swipe-left', () => { ... });
 *   gestures.on('top-swipe-down', () => { ... });
 *   gestures.on('*', (zone, direction) => { ... });
 */

const DEG = Math.PI / 180;

export class GestureDetector {
    /**
     * @param {() => number} getRotation — returns current CSS rotation in degrees
     */
    constructor(getRotation) {
        this.getRotation = getRotation;
        this._listeners = {};
        this.suppressed = false;
        this._debugSvg = null;

        this._setup();
    }

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    _emit(zone, direction, data) {
        const event = `${zone}-swipe-${direction}`;
        for (const cb of this._listeners[event] || []) cb(data);
        for (const cb of this._listeners['*'] || []) cb(zone, direction, data);
    }

    /**
     * Convert screen coordinates to clock-local coordinates.
     * Uses a screen-centered square (viewport height) and counter-rotates
     * by the clock's CSS rotation so zones stay on the clock face.
     * Returns { x, y } in range -0.5 to 0.5.
     */
    _toLocal(clientX, clientY) {
        const size = window.innerHeight;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        // Screen offset from center, normalized to the square
        const sx = (clientX - cx) / size;
        const sy = (clientY - cy) / size;

        // Counter-rotate by the clock's CSS rotation
        const rad = -this.getRotation() * DEG;
        return {
            x: sx * Math.cos(rad) - sy * Math.sin(rad),
            y: sx * Math.sin(rad) + sy * Math.cos(rad),
        };
    }

    _setup() {
        const THRESHOLD = 0.08;  // min travel to trigger (normalized)

        // Zone rectangles in normalized physical coords (-0.5 to 0.5)
        const ZONES = {
            top:   { x1: -0.25, x2: 0.25, y1: -0.50, y2: -0.40 },
            left:  { x1: -0.50, x2: -0.40, y1: -0.25, y2: 0.25 },
            right: { x1:  0.40, x2:  0.50, y1: -0.25, y2: 0.25 },
        };

        const hitZone = (pos) => {
            for (const [name, z] of Object.entries(ZONES)) {
                if (pos.x >= z.x1 && pos.x <= z.x2 && pos.y >= z.y1 && pos.y <= z.y2) {
                    return name;
                }
            }
            return 'middle';
        };

        let startPos = null;
        let startZone = null;    // 'left' | 'right' | 'top' | 'middle'
        let fired = false;

        const onStart = (e) => {
            if (this.suppressed) return;
            const t = e.touches ? e.touches[0] : e;
            const pos = this._toLocal(t.clientX, t.clientY);

            startZone = hitZone(pos);
            startPos = pos;
            startScreen = { x: t.clientX, y: t.clientY };
            fired = false;
        };

        let startScreen = null;

        const onMove = (e) => {
            if (!startPos) return;

            const t = e.touches ? e.touches[0] : e;

            if (fired) return;

            // Use screen-space delta, then counter-rotate to clock-local
            const sdx = (t.clientX - startScreen.x) / window.innerHeight;
            const sdy = (t.clientY - startScreen.y) / window.innerHeight;
            const rad = -this.getRotation() * DEG;
            const dx = sdx * Math.cos(rad) - sdy * Math.sin(rad);
            const dy = sdx * Math.sin(rad) + sdy * Math.cos(rad);

            const absX = Math.abs(dx);
            const absY = Math.abs(dy);

            if (absX < THRESHOLD && absY < THRESHOLD) return;

            fired = true;

            // Determine direction — dominant axis wins
            if (absX > absY) {
                // Horizontal swipe
                this._emit(startZone, dx > 0 ? 'right' : 'left');
            } else {
                this._emit(startZone, dy > 0 ? 'down' : 'up');
            }
        };

        const onEnd = () => {
            startPos = null;
            startScreen = null;
            startZone = null;
        };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);

        // --- Debug zone overlay ---

        const ZONE_COLORS = {
            top:   'rgba(231, 76, 60, 0.3)',
            left:  'rgba(46, 204, 113, 0.3)',
            right: 'rgba(52, 152, 219, 0.3)',
        };

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '-0.5 -0.5 1 1');
        svg.style.cssText = `
            position: fixed;
            width: 100vh;
            height: 100vh;
            top: 50%;
            left: 50%;
            pointer-events: none;
            z-index: 200;
            display: none;
        `;

        for (const [name, z] of Object.entries(ZONES)) {
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', z.x1);
            rect.setAttribute('y', z.y1);
            rect.setAttribute('width', z.x2 - z.x1);
            rect.setAttribute('height', z.y2 - z.y1);
            rect.setAttribute('fill', ZONE_COLORS[name]);
            svg.appendChild(rect);
        }

        document.body.appendChild(svg);
        this._debugSvg = svg;

        // Orientation drag zone — fixed screen-space bottom 10%
        const orientStrip = document.createElement('div');
        orientStrip.style.cssText = `
            position: fixed;
            left: 0;
            bottom: 0;
            width: 100%;
            height: 4%;
            background: rgba(241, 196, 15, 0.3);
            pointer-events: none;
            z-index: 200;
            display: none;
        `;
        document.body.appendChild(orientStrip);
        this._debugOrientStrip = orientStrip;

        // Update rotation each frame
        const updateDebug = () => {
            if (this._debugSvg.style.display !== 'none') {
                const rot = this.getRotation();
                this._debugSvg.style.transform =
                    `translate(-50%, -50%) rotate(${rot}deg)`;
            }
            requestAnimationFrame(updateDebug);
        };
        requestAnimationFrame(updateDebug);
    }

    showDebugZones(visible) {
        this._debugSvg.style.display = visible ? 'block' : 'none';
        this._debugOrientStrip.style.display = visible ? 'block' : 'none';
    }
}
