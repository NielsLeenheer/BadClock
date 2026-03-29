/**
 * Rotation-aware edge-swipe detection for switching between two modes.
 * Detects swipes from screen edges, compensating for display rotation
 * so "left" and "right" stay relative to the clock face orientation.
 *
 * Layout: [left mode] [right mode]
 * Swipe left → switch to right mode, swipe right → switch to left mode.
 */
export class SwipeSwitch {
    constructor({ getRotation }) {
        this.getRotation = getRotation;
        this.onSwipeLeft = null;   // () => void — user swiped toward right mode
        this.onSwipeRight = null;  // () => void — user swiped toward left mode

        this.setup();
    }

    setup() {
        const EDGE = 44;
        const THRESHOLD = 80;
        let startLX = null;
        let startLY = null;
        let swiped = false;

        const toLocal = (clientX, clientY) => {
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const dx = clientX - cx;
            const dy = clientY - cy;
            const rad = -this.getRotation() * Math.PI / 180;
            return {
                x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
                y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
            };
        };

        const onStart = (e) => {
            const t = e.touches ? e.touches[0] : e;
            const local = toLocal(t.clientX, t.clientY);
            if (local.x < EDGE || local.x > window.innerWidth - EDGE) {
                startLX = local.x;
                startLY = local.y;
                swiped = false;
            }
        };

        const onMove = (e) => {
            if (startLX === null || swiped) return;
            const t = e.touches ? e.touches[0] : e;
            const local = toLocal(t.clientX, t.clientY);
            const dx = local.x - startLX;
            const dy = local.y - startLY;

            if (Math.abs(dx) > THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
                swiped = true;
                if (dx < 0 && this.onSwipeLeft) {
                    this.onSwipeLeft();
                } else if (dx > 0 && this.onSwipeRight) {
                    this.onSwipeRight();
                }
            }
        };

        const onEnd = () => { startLX = null; };

        document.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    }
}
