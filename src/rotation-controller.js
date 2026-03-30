/**
 * Manages device rotation with a dead zone and snap-to-90°.
 *
 * - Ignores small angle changes (dead zone) to prevent jitter
 * - When the sensor is still for a while, snaps to nearest 90° angle
 * - Does NOT apply CSS — consumers read `rotation` and apply it themselves
 */
export class RotationController {
    constructor({ deadZone = 8, snapDistance = 12, snapDelay = 800 } = {}) {
        this.rotation = 0;
        this.committedRotation = 0;
        this.lastChangeTime = 0;

        this.DEAD_ZONE = deadZone;
        this.SNAP_DISTANCE = snapDistance;
        this.SNAP_DELAY = snapDelay;

        this.onChange = null;
    }

    /** Feed a new sensor angle. Returns true if rotation changed. */
    update(newAngle) {
        let diff = newAngle - this.committedRotation;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        if (Math.abs(diff) < this.DEAD_ZONE) return false;

        this.committedRotation = newAngle;
        this.rotation = newAngle;
        this.lastChangeTime = Date.now();

        if (this.onChange) this.onChange();
        return true;
    }

    /** Call each frame to snap when sensor is still. */
    snapCheck() {
        const elapsed = Date.now() - this.lastChangeTime;
        if (elapsed < this.SNAP_DELAY) return;

        const nearest90 = Math.round(this.committedRotation / 90) * 90;
        let diff = nearest90 - this.committedRotation;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        if (Math.abs(diff) > 0.5 && Math.abs(diff) <= this.SNAP_DISTANCE) {
            this.committedRotation = nearest90;
            this.rotation = nearest90;
        }
    }

    /** Set rotation directly (e.g. from manual mode), bypassing dead zone. */
    set(angle) {
        this.rotation = angle;
        this.committedRotation = angle;
    }
}
