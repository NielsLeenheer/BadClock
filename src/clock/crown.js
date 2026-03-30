/**
 * Crown winding mechanism.
 *
 * Tracks winding energy (0..1). Energy decays over 24 hours.
 * When energy is low, the clock drifts.
 * When over-wound (energy > 1), calls onOverwind.
 *
 * Slide reveal/hide and winding gestures are handled externally
 * by the GestureDetector via clock.js.
 */

const OVERWIND_THRESHOLD = 1.2;
const DECAY_PER_MS = 1 / (48 * 60 * 60 * 1000);

export class Crown {
    constructor(analogEl) {
        this.crownEl = analogEl.querySelector('#crown');
        this.energy = 1.0;
        this.revealed = false;
        this._lastDecay = Date.now();

        this.onOverwind = null;
        this._bgOffset = 0;
    }

    reveal() {
        this.revealed = true;
        this.crownEl.classList.add('revealed');
    }

    hide() {
        this.revealed = false;
        this.crownEl.classList.remove('revealed');
    }

    wind(amount) {
        this.energy = Math.max(0, this.energy + amount);

        // Animate the knurled texture
        this._bgOffset += amount > 0 ? 12 : -12;
        this.crownEl.style.backgroundPosition = `0 ${this._bgOffset}px`;

        if (this.energy > OVERWIND_THRESHOLD) {
            this.energy = 0;
            if (this.onOverwind) this.onOverwind();
        }
    }

    /** Returns drift multiplier: 1.0 = no drift, 0.0 = fully unwound */
    update() {
        const now = Date.now();
        const elapsed = now - this._lastDecay;
        this._lastDecay = now;

        this.energy = Math.max(0, this.energy - elapsed * DECAY_PER_MS);

        if (this.energy > 0.3) return 1.0;
        return this.energy / 0.3;
    }
}
