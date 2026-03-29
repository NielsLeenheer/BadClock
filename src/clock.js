/**
 * Clock facade — the only interface main.js needs.
 * Owns the clock faces, mode switching, rotation, and shake detection internally.
 */
import { AnalogClock } from './clock/analog.js';
import { DigitalClock } from './clock/digital.js';
import { ModeSwitcher } from './clock/mode-switcher.js';
import { RotationController } from './rotation-controller.js';
import { ShakeDetector } from './shake-detector.js';

export class Clock {
    constructor(el, { perfMultiplier = 1.0 } = {}) {
        // Shared time offset — single source of truth
        this.time = { value: 0 };

        // Clock faces
        const analogEl = el.querySelector('#analog');
        const digitalEl = el.querySelector('#digital');
        this.analogClock = new AnalogClock(analogEl, this.time, perfMultiplier);
        this.digitalClock = new DigitalClock(digitalEl, this.time);

        // Mode switching
        this.modes = new ModeSwitcher();
        this.modes.add('digital', digitalEl);
        this.modes.add('analog', analogEl);

        // Rotation
        this.rotation = new RotationController(el);
        this.rotation.onChange = (change) => this.analogClock.applyRotationInertia(change);

        // Shake detection
        this.shakeDetector = new ShakeDetector();
        this.shakeDetector.onShake = () => {
            if (!this.manualMode && !this.isShaking && this.currentMode === 'analog') {
                this.analogClock.enterShakeMode();
                this.onShakeModeChanged?.();
            }
        };

        // Manual mode state
        this.manualMode = false;
        this.manualOrientation = 0;
        this.autoOrientation = 0;

        // Callbacks for external UI (debug panel)
        this.onShakeModeChanged = null;
        this.onManualModeChanged = null;

        this.animate();
    }

    /* ---- Public getters ---- */

    get isShaking() {
        return this.analogClock.isShaking;
    }

    get currentMode() {
        return this.modes.current;
    }

    get displayRotation() {
        return this.rotation.rotation;
    }

    get timeOffset() {
        return this.time.value;
    }

    /* ---- Mode switching ---- */

    nextMode() {
        this.modes.next();
    }

    prevMode() {
        this.modes.prev();
    }

    /* ---- Shake mode ---- */

    toggleShakeMode() {
        if (this.analogClock.isShaking) {
            this.analogClock.exitShakeMode();
        } else {
            this.analogClock.enterShakeMode();
        }
        this.onShakeModeChanged?.();
    }

    /* ---- Manual mode ---- */

    enableManualMode() {
        if (!this.manualMode) {
            this.manualMode = true;
            this.onManualModeChanged?.(true);
        }
    }

    disableManualMode() {
        this.manualMode = false;
        this.manualOrientation = this.autoOrientation;
        this.onManualModeChanged?.(false);
    }

    setManualOrientation(angle) {
        this.enableManualMode();
        this.manualOrientation = angle;
    }

    /* ---- Orientation input ---- */

    handleOrientation(data) {
        const { x, y, z } = data;

        if (!this.isShaking && this.currentMode === 'analog') {
            this.shakeDetector.feed(z, 0.3);
        }

        const angle = Math.atan2(-x, -y) * (180 / Math.PI);
        this.autoOrientation = angle;
        this.rotation.update(angle);
    }

    handleRawAccel(data) {
        if (!this.isShaking && this.currentMode === 'analog') {
            this.shakeDetector.feed(data.z, 2.0);
        }
    }

    /* ---- Animation loop ---- */

    animate() {
        if (!this.manualMode) {
            this.rotation.snapCheck();
        } else {
            const target = -this.manualOrientation;
            if (target !== this.rotation.rotation) {
                const change = target - this.rotation.rotation;
                this.rotation.set(target);
                this.analogClock.applyRotationInertia(change);
            }
        }

        this.analogClock.update();
        this.digitalClock.update();

        requestAnimationFrame(() => this.animate());
    }
}
