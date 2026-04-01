/**
 * Clock facade — the only interface main.js needs.
 * Owns the clock faces, mode switching, rotation, and shake detection internally.
 */
import { AnalogClock } from './clock/analog.js';
import { DigitalClock } from './clock/digital.js';
import { Hand } from './clock/hand.js';
import { ModeSwitcher } from './clock/mode-switcher.js';
import { RotationController } from './rotation-controller.js';
import { ShakeDetector } from './shake-detector.js';

export class Clock {
    constructor(el) {
        this.el = el;
        this.time = { value: 0 };

        // Clock faces
        const analogEl = el.querySelector('#analog');
        const digitalEl = el.querySelector('#digital');
        this.analogClock = new AnalogClock(analogEl, this.time);
        this.digitalClock = new DigitalClock(digitalEl, this.time);

        // Mode switching
        this.modes = new ModeSwitcher();
        this.modes.add('digital', digitalEl);
        this.modes.add('analog', analogEl);

        // Rotation — tracks device orientation
        this.rotation = new RotationController();
        this._renderedRotation = null;
        this._modeSwitchUntil = 0;

        // Shake detection
        this.shakeDetector = new ShakeDetector();
        this.shakeDetector.onShake = () => {
            if (!this.manualMode && this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
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
        this.onDSTTriggered = null;

        // DST detection state
        this._lastTimezoneOffset = new Date().getTimezoneOffset();
        this._dstCheckInterval = 0;
        this._lastDstBehavior = null; // for debug display

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
        this._modeSwitchUntil = Date.now() + 400;
        this._updateVisibility();
        this._maybeSpillBeans();
    }
    prevMode() {
        this.modes.prev();
        this._modeSwitchUntil = Date.now() + 400;
        this._updateVisibility();
        this._maybeSpillBeans();
    }

    /* ---- Crown ---- */

    get crownEnergy() { return this.analogClock.crown.energy; }
    get isCrownRevealed() { return this.analogClock.crown.revealed; }
    showCrown() { this.analogClock.crown.reveal(); }
    hideCrown() { this.analogClock.crown.hide(); }
    windCrown(amount) { this.analogClock.crown.wind(amount); }

    /* ---- Motors ---- */

    setMotorsEnabled(enabled) {
        for (const hand of this.analogClock.hands) {
            if (hand.joint && hand._mode === 'clock') {
                hand.joint.enableMotor(enabled);
            }
        }
        this._motorsEnabled = enabled;
    }

    /* ---- Shake mode ---- */

    toggleShakeMode() {
        this.analogClock.enterShakeMode();
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

        if (this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
            this.shakeDetector.feed(z, 0.3);
        }

        const angle = Math.atan2(-x, -y) * (180 / Math.PI);
        this.autoOrientation = angle;
        this.rotation.update(angle);
    }

    handleRawAccel(data) {
        if (this.analogClock.hasShakeableHands && this.currentMode === 'analog') {
            this.shakeDetector.feed(data.z, 2.0);
        }
    }

    /* ---- Debug commands ---- */

    debug = {
        detachAll: () => this.analogClock.debugDetachAll(),
        detach: (i = 2) => this.analogClock.debugDetach(i),
        spin: (i = 2, speed = 30) => this.analogClock.debugSpin(i, speed),
        overwind: () => this.analogClock.debugOverwind(),
        setForceDetachOnDrag: (on) => { Hand.forceDetachOnDrag = on; },
        energy: (e) => this.analogClock.debugSetEnergy(e),
        crown: (show = true) => this.analogClock.debugCrown(show),
        beans: () => this.analogClock.debugBeans(),
        flicker: () => this.digitalClock.debugFlicker(),
        decay: (min = 5) => this.digitalClock.debugDecay(min),
        shake: () => this.enterShakeMode(),
        dst: (offset = -60) => this.simulateDST(offset),
        help: () => {
            console.table({
                'detachAll()':     'Detach all analog hands',
                'detach(i)':       'Detach hand (0=hour, 1=min, 2=sec)',
                'spin(i, speed)':  'Spin a hand (may detach if fast enough)',
                'overwind()':      'Over-wind → all hands fly off',
                'energy(0..1)':    'Set crown winding energy',
                'crown(bool)':     'Show/hide the crown',
                'beans()':         'Pour baked beans onto the clock face',
                'flicker()':       'Random digital segment flicker',
                'decay(minutes)':  'Age digital segments',
                'shake()':         'Enter gravity mode',
                'dst(offset)':     'Simulate DST transition (-60=spring fwd, 60=fall back)',
            });
        },
    };

    enterShakeMode() {
        if (!this.analogClock.isShaking) {
            this.analogClock.enterShakeMode();
            this.onShakeModeChanged?.();
        }
    }

    _maybeSpillBeans() {
        // 1 in 30 chance of beans on face switch (only when switching TO analog)
        if (this.currentMode === 'analog' && !this.analogClock.beans.active && Math.random() < 1 / 30) {
            this.analogClock.beans.pour();
        }
    }

    /* ---- Animation loop ---- */

    animate() {
        if (!this.manualMode) {
            this.rotation.snapCheck();
        } else {
            const target = -this.manualOrientation;
            if (target !== this.rotation.rotation) {
                this.rotation.set(target);
            }
        }

        const rot = this.rotation.rotation;

        // Counter-rotate #clock to keep faces upright
        if (rot !== this._renderedRotation) {
            this.el.style.transform = `rotate(${rot}deg)`;
            this._renderedRotation = rot;

            // Tell analog clock the orientation (for gravity and rendering)
            this.analogClock.setOrientation(rot);
        }

        const switching = Date.now() < this._modeSwitchUntil;
        this.analogClock.visible = this.currentMode !== 'digital' || switching;
        this.analogClock.update();
        if (this.currentMode === 'digital' || switching) {
            this.digitalClock.update();
        }

        // Check for DST transitions (throttled — every ~300 frames ≈ 5s)
        if (++this._dstCheckInterval >= 300) {
            this._dstCheckInterval = 0;
            this._checkDST();
        }

        requestAnimationFrame(() => this.animate());
    }

    /* ---- DST detection ---- */

    _checkDST() {
        const currentOffset = new Date().getTimezoneOffset();
        if (currentOffset === this._lastTimezoneOffset) return;

        // Timezone offset changed — DST transition detected
        // offsetDiff is in minutes: negative = clocks moved forward, positive = clocks moved back
        const offsetDiff = currentOffset - this._lastTimezoneOffset;
        this._lastTimezoneOffset = currentOffset;

        this._applyDSTBehavior(offsetDiff);
    }

    _applyDSTBehavior(offsetDiffMinutes) {
        const roll = Math.random();
        const shiftMs = offsetDiffMinutes * 60 * 1000;

        if (roll < 1 / 3) {
            // Correct — do nothing, system already adjusted
            this._lastDstBehavior = 'correct';
        } else if (roll < 2 / 3) {
            // Forgot — cancel the DST change
            this.time.value += shiftMs;
            this._lastDstBehavior = 'forgot';
        } else {
            // Reversed — shift the wrong way (double)
            this.time.value += shiftMs * 2;
            this._lastDstBehavior = 'reversed';
        }

        this.onDSTTriggered?.(this._lastDstBehavior, offsetDiffMinutes);
    }

    /** Debug: simulate a DST transition (default: spring forward = -60 min offset change) */
    simulateDST(offsetDiffMinutes = -60) {
        this._applyDSTBehavior(offsetDiffMinutes);
    }

    _updateVisibility() {
        this.analogClock.visible = true; // always visible during switch
    }
}
