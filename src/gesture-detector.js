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
    }
}
