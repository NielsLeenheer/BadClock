/**
 * Manages device rotation with smooth interpolation and snap-to-90°.
 *
 * - Smoothly interpolates towards target angle (filters jitter)
 * - Jumps immediately for large angle changes
 * - When the sensor is still for a while, snaps to nearest 90° angle
 * - Does NOT apply CSS — consumers read `rotation` and apply it themselves
 */
export class RotationController {
    constructor({ lerpFactor = 0.25, jumpThreshold = 5, snapDistance = 12, snapDelay = 800 } = {}) {
        this.rotation = 0;          // Current displayed rotation (smoothed)
        this.targetRotation = 0;    // Target from sensor
        this.lastChangeTime = 0;

        this.LERP_FACTOR = lerpFactor;      // 0.1 = slow/smooth, 0.3 = fast/responsive
        this.JUMP_THRESHOLD = jumpThreshold; // Jump immediately if diff > this
        this.SNAP_DISTANCE = snapDistance;
        this.SNAP_DELAY = snapDelay;

        this.onChange = null;
    }

    /** Feed a new sensor angle. */
    update(newAngle) {
        // Check if target changed significantly (for snap timing)
        let diff = newAngle - this.targetRotation;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        if (Math.abs(diff) > 1) {
            this.lastChangeTime = Date.now();
        }

        this.targetRotation = newAngle;
    }

    /** Call each frame to interpolate and snap. */
    tick() {
        // Interpolate towards target
        let diff = this.targetRotation - this.rotation;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        const absDiff = Math.abs(diff);

        if (absDiff > 0.1) {
            if (absDiff > 10) {
                // Large change: jump immediately
                this.rotation = this.targetRotation;
            } else {
                // Scale lerp factor based on diff size
                // Small diff (0-2°): slow lerp (0.1)
                // Medium diff (5-10°): fast lerp (0.5)
                const t = Math.min(absDiff / 10, 1);  // 0 to 1
                const lerpFactor = 0.1 + t * 0.4;     // 0.1 to 0.5
                this.rotation += diff * lerpFactor;
            }

            // Normalize to 0-360
            while (this.rotation < 0) this.rotation += 360;
            while (this.rotation >= 360) this.rotation -= 360;

            if (this.onChange) this.onChange();
        }

        // Snap check (when stable)
        this.snapCheck();
    }

    /** Snap to nearest 90° when sensor is still. */
    snapCheck() {
        const elapsed = Date.now() - this.lastChangeTime;
        if (elapsed < this.SNAP_DELAY) return;

        const nearest90 = Math.round(this.targetRotation / 90) * 90;
        let diff = nearest90 - this.targetRotation;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        if (Math.abs(diff) > 0.5 && Math.abs(diff) <= this.SNAP_DISTANCE) {
            this.targetRotation = nearest90;
        }
    }

    /** Set rotation directly (e.g. from manual mode), bypassing interpolation. */
    set(angle) {
        this.rotation = angle;
        this.targetRotation = angle;
    }
}
