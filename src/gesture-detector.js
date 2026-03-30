/**
 * Orientation-aware edge gesture detector.
 *
 * Detects swipes starting from the left or right 10% of the clock face,
 * in four directions: left, right, up, down.
 *
 * All coordinates are in physical space — compensated for device rotation
 * so "left" always means physical left regardless of screen orientation.
 *
 * Usage:
 *   const gestures = new GestureDetector(clockElement, () => rotation);
 *   gestures.on('right-swipe-left', () => { ... });
 *   gestures.on('right-swipe-up', () => { ... });
 *   gestures.on('left-swipe-right', () => { ... });
 *   gestures.on('middle-swipe-left', () => { ... });
 */

const DEG = Math.PI / 180;

export class GestureDetector {
    /**
     * @param {HTMLElement} element — the clock container
     * @param {() => number} getRotation — returns current CSS rotation in degrees
     */
    constructor(element, getRotation) {
        this.element = element;
        this.getRotation = getRotation;
        this._listeners = {};

        this._setup();
    }

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    _emit(zone, direction) {
        const event = `${zone}-swipe-${direction}`;
        for (const cb of this._listeners[event] || []) cb();
        for (const cb of this._listeners['*'] || []) cb(zone, direction);
    }

    /**
     * Convert screen coordinates to physical (rotation-compensated)
     * coordinates relative to the element center. Returns { x, y }
     * where x/y are in the range -0.5 to 0.5 (normalized to element size).
     */
    _toPhysical(clientX, clientY) {
        const rect = this.element.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // Screen offset from center, normalized
        const sx = (clientX - cx) / rect.width;
        const sy = (clientY - cy) / rect.height;

        // Un-rotate by the CSS rotation to get physical coordinates
        const rad = -this.getRotation() * DEG;
        return {
            x: sx * Math.cos(rad) - sy * Math.sin(rad),
            y: sx * Math.sin(rad) + sy * Math.cos(rad),
        };
    }

    _setup() {
        const EDGE = 0.10;       // 10% from each side
        const THRESHOLD = 0.08;  // min travel to trigger (normalized)

        let startPos = null;
        let startZone = null;    // 'left' | 'right' | null
        let fired = false;

        const onStart = (e) => {
            const t = e.touches ? e.touches[0] : e;
            const pos = this._toPhysical(t.clientX, t.clientY);

            if (pos.x < -0.5 + EDGE) {
                startZone = 'left';
            } else if (pos.x > 0.5 - EDGE) {
                startZone = 'right';
            } else {
                startZone = 'middle';
            }

            startPos = pos;
            fired = false;
        };

        const onMove = (e) => {
            if (!startPos || fired) return;

            const t = e.touches ? e.touches[0] : e;
            const pos = this._toPhysical(t.clientX, t.clientY);
            const dx = pos.x - startPos.x;
            const dy = pos.y - startPos.y;

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
