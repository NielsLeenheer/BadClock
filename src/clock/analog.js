import './analog.css';
import { Hand } from './hand.js';

const HOUR_MINUTE_CORRECTION = 3 / 60;
const SECOND_CORRECTION = 12 / 60;

export class AnalogClock {
    /**
     * @param {HTMLElement} element
     * @param {{ value: number }} time - shared time offset ref
     * @param {number} perfMultiplier
     */
    constructor(element, time, perfMultiplier = 1.0) {
        this.element = element;
        this.time = time;
        this._shakeMode = false;

        this.hands = [
            new Hand(element.querySelector('#hour-hand'), 43200000, {
                springConstant: 0.002 * perfMultiplier,
                damping: Math.pow(0.99, perfMultiplier),
            }),
            new Hand(element.querySelector('#minute-hand'), 3600000, {
                springConstant: 0.0025 * perfMultiplier,
                damping: Math.pow(0.985, perfMultiplier),
            }),
            new Hand(element.querySelector('#second-hand'), 60000, {
                springConstant: 0.003 * perfMultiplier,
                damping: Math.pow(0.98, perfMultiplier),
            }),
        ];

        this.setCurrentTime();
    }

    get isShaking() {
        return this._shakeMode;
    }

    /* ---- Time ---- */

    setCurrentTime() {
        const now = new Date();
        const h = now.getHours() % 12;
        const m = now.getMinutes();
        const s = now.getSeconds();

        this.hands[0].setAngle((h + m / 60) * 30);
        this.hands[1].setAngle((m + s / 60) * 6);
        this.hands[2].setAngle(s * 6);
    }

    /* ---- Shake / gravity mode ---- */

    enterShakeMode() {
        this._shakeMode = true;
        this.element.classList.add('shake-mode');

        const exit = () => this.exitShakeMode();
        for (const hand of this.hands) {
            hand.enableGravityMode(180);
            hand.onDragInGravityMode = exit;
        }
    }

    exitShakeMode() {
        this._shakeMode = false;
        this.element.classList.remove('shake-mode');

        for (const hand of this.hands) {
            hand.disableGravityMode();
            hand.onDragInGravityMode = null;
            hand.settle();
        }
    }

    applyRotationInertia(rotationChange) {
        if (!this._shakeMode) return;

        for (const hand of this.hands) {
            hand.applyClockRotationInertia(rotationChange);
            hand.updateGravityTarget(180);
        }
    }

    /* ---- Per-frame update ---- */

    update() {
        const now = Date.now();

        for (const hand of this.hands) {
            hand.update();
        }

        if (this._shakeMode) return;

        // If user dragged hands and they've all settled, derive new time offset
        const anyManual = this.hands.some(h => h.wasManuallySet);
        const allSettled = this.hands.every(h => h.canCorrect);

        if (anyManual && allSettled) {
            const setTime = new Date();
            setTime.setHours(Math.floor(this.hands[0].angle / 30));
            setTime.setMinutes(Math.floor(this.hands[1].angle / 6));
            setTime.setSeconds(Math.floor(this.hands[2].angle / 6));
            setTime.setMilliseconds(0);

            this.time.value = setTime.getTime() - now;

            for (const hand of this.hands) {
                hand.clearManuallySet();
            }
        }

        // Correct hands toward target time
        const displayTime = new Date(now + this.time.value);
        const h = displayTime.getHours() % 12;
        const m = displayTime.getMinutes();
        const s = displayTime.getSeconds();
        const ms = displayTime.getMilliseconds();

        this.hands[2].correctToward((s + ms / 1000) * 6, SECOND_CORRECTION);
        this.hands[1].correctToward((m + s / 60) * 6, HOUR_MINUTE_CORRECTION);
        this.hands[0].correctToward((h + m / 60) * 30, HOUR_MINUTE_CORRECTION);
    }
}
