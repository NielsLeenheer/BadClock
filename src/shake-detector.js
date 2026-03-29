/**
 * Detects shake gestures from accelerometer Z-axis data.
 * Looks for rapid back-and-forth direction reversals.
 */
export class ShakeDetector {
    constructor() {
        this.history = [];
        this.onShake = null; // () => void
    }

    /**
     * Feed a Z-axis sample. Call this from orientation or raw accel events.
     * @param {number} zValue - Z-axis acceleration value
     * @param {number} threshold - Minimum Z-change to count as significant (0.3 for g-units, 2.0 for m/s²)
     */
    feed(zValue, threshold) {
        const now = Date.now();
        this.history.push({ time: now, z: zValue });
        this.history = this.history.filter(entry => now - entry.time < 600);

        if (this.history.length <= 6) return;

        let reversals = 0;
        let prevZDiff = 0;

        for (let i = 1; i < this.history.length; i++) {
            const prev = this.history[i - 1];
            const curr = this.history[i];
            if (prev.z === undefined || curr.z === undefined) continue;

            const zDiff = curr.z - prev.z;

            if (i > 1 && prevZDiff !== 0 && zDiff !== 0) {
                if (Math.abs(prevZDiff) > threshold && Math.abs(zDiff) > threshold) {
                    if ((prevZDiff > 0 && zDiff < 0) || (prevZDiff < 0 && zDiff > 0)) {
                        reversals++;
                    }
                }
            }
            prevZDiff = zDiff;
        }

        if (reversals >= 2 && this.onShake) {
            this.onShake();
        }
    }

    reset() {
        this.history = [];
    }
}
