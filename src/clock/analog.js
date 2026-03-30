import './analog.css';
import { World, Vec2, Chain } from 'planck';
import { Hand, CAT_BOUNDARY } from './hand.js';
import { Crown } from './crown.js';

const DEG = Math.PI / 180;
const WORLD_RADIUS = 5;
const TIME_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
const GRAVITY = 15;

export class AnalogClock {
    constructor(element, time, perfMultiplier = 1.0) {
        this.element = element;
        this.time = time;
        this._orientation = 0;
        this._driftAccumulator = 0;
        this._cachedClockRadius = 0;
        this._lastUpdateTime = 0;
        this._physicsAccumulator = 0;

        // Time model — physical space, no gravity
        this.timeWorld = World(Vec2(0, 0));
        this.anchor = this.timeWorld.createBody({
            type: 'kinematic',
            position: Vec2(0, 0),
        });
        // Anchor stays at 0 — never rotates

        // Gravity model — screen space, gravity rotates with orientation
        this.gravityWorld = World(Vec2(0, -GRAVITY));
        this.pivot = this.gravityWorld.createBody({
            type: 'static',
            position: Vec2(0, 0),
        });

        // Boundary in gravity world (for detached hands bouncing)
        this.boundary = this.gravityWorld.createBody({ type: 'static', position: Vec2(0, 0) });
        const pts = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            pts.push(Vec2(Math.cos(a) * WORLD_RADIUS, Math.sin(a) * WORLD_RADIUS));
        }
        this.boundary.createFixture(Chain(pts, true), {
            friction: 0.3,
            restitution: 0.4,
            filterCategoryBits: CAT_BOUNDARY,
            filterMaskBits: 0xFFFF,
        });

        // Worlds and anchors passed to hands
        const worlds = { time: this.timeWorld, gravity: this.gravityWorld };
        const anchors = { anchor: this.anchor, pivot: this.pivot };

        // Hands — start in time model
        const face = element.querySelector('#analog-face');
        this.hands = [
            new Hand(face.querySelector('#hour-hand'), worlds, anchors, {
                length: 2.5, width: 0.25, density: 2.0,
                motorTorque: 4, motorGain: 0.5,
            }),
            new Hand(face.querySelector('#minute-hand'), worlds, anchors, {
                length: 3.5, width: 0.18, density: 1.0,
                motorTorque: 2.5, motorGain: 0.5,
            }),
            new Hand(face.querySelector('#second-hand'), worlds, anchors, {
                length: 4.0, width: 0.08, density: 0.3,
                motorTorque: 1, motorGain: 0.5,
            }),
        ];

        for (const hand of this.hands) {
            hand.onDetachDuringDrag = () => this._updateShakeClass();
        }

        // Cache clock radius, update on resize
        this._cachedClockRadius = element.clientWidth / 2;
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => {
                this._cachedClockRadius = element.clientWidth / 2;
            }).observe(element);
        }

        // Crown
        this.crown = new Crown(element);
        this.crown.onOverwind = () => {
            let delay = 0;
            for (const hand of this.hands) {
                if (hand.isInTimeModel) {
                    // Clock/coasting hands: detach and fling with staggered delay
                    const h = hand;
                    setTimeout(() => {
                        h.detach();
                        h.body.setLinearVelocity(Vec2(
                            (Math.random() - 0.5) * 20,
                            (Math.random() - 0.5) * 20
                        ));
                        h.body.setAngularVelocity((Math.random() - 0.5) * 20);
                        this._updateShakeClass();
                    }, delay);
                    delay += 10 + Math.random() * 40;
                } else if (hand._mode === 'gravity') {
                    // Swinging hand: detach from pivot with a small push so it
                    // clears the reattach zone before the next frame
                    hand.detach();
                    hand.body.setLinearVelocity(Vec2(
                        (Math.random() - 0.5) * 4,
                        3 + Math.random() * 3
                    ));
                }
                // Already detached: do nothing
            }
            this._updateShakeClass();
        };

        // Hour tick marks
        for (let i = 0; i < 12; i++) {
            const tick = document.createElement('div');
            tick.className = 'clock-tick';
            tick.style.cssText = `
                position: absolute;
                top: 2%;
                left: 50%;
                width: 2px;
                height: 6%;
                background: ${i === 0 ? '#fff' : '#555'};
                transform-origin: 50% 800%;
                transform: translateX(-50%) rotate(${i * 30}deg);
                pointer-events: none;
                z-index: 0;
            `;
            face.appendChild(tick);
        }

        // Debug: gravity direction indicator (yellow = raw gravity, green = rendered)
        this._gravLineRaw = document.createElement('div');
        this._gravLineRaw.className = 'debug-overlay';
        this._gravLineRaw.style.cssText = `
            position: absolute; bottom: 50%; left: 50%; width: 4px; height: 20%;
            background: rgba(255,255,0,0.5); border-radius: 2px;
            transform-origin: 50% 100%; pointer-events: none; z-index: 15;
        `;
        face.appendChild(this._gravLineRaw);

        this._gravLineRendered = document.createElement('div');
        this._gravLineRendered.className = 'debug-overlay';
        this._gravLineRendered.style.cssText = `
            position: absolute; bottom: 50%; left: 50%; width: 4px; height: 20%;
            background: rgba(0,255,0,0.5); border-radius: 2px;
            transform-origin: 50% 100%; pointer-events: none; z-index: 15;
        `;
        face.appendChild(this._gravLineRendered);

        this.setCurrentTime();
    }

    get isShaking() {
        return this.hands.some(h => h.isInGravityModel);
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

    /* ---- Orientation ---- */

    setOrientation(degrees) {
        this._orientation = degrees;

        // Rotate gravity in gravity model to point toward physical floor.
        // degrees = CSS rotation of #clock (negated device tilt).
        // Physical down in screen space is at angle -degrees from screen-down.
        const rad = degrees * DEG;
        this.gravityWorld.setGravity(Vec2(
            -GRAVITY * Math.sin(rad),
            -GRAVITY * Math.cos(rad)
        ));

        // Debug indicators (only compute when visible)
        if (document.body.classList.contains('debug-mode')) {
            const gx = -GRAVITY * Math.sin(rad);
            const gy = -GRAVITY * Math.cos(rad);
            const gravScreenDeg = Math.atan2(gx, -gy) * (180 / Math.PI);
            const gravRenderDeg = gravScreenDeg - degrees;

            this._gravLineRaw.style.transform = `translateX(-50%) rotate(${gravScreenDeg}deg)`;
            this._gravLineRendered.style.transform = `translateX(-50%) rotate(${gravRenderDeg}deg)`;
        }

        for (const hand of this.hands) {
            hand._orientation = degrees;
            if (hand.isInGravityModel) {
                hand.body.setAwake(true);
            }
        }
    }

    /* ---- Shake / gravity mode ---- */

    enterShakeMode() {
        for (const hand of this.hands) {
            if (!hand.isInTimeModel) continue;
            hand.enterGravityMode();
            hand.onDragInGravityMode = () => {
                hand.onDragInGravityMode = null;
                this._updateShakeClass();
            };
        }
        this._updateShakeClass();
    }

    exitShakeMode() {
        for (const hand of this.hands) {
            hand.exitGravityMode();
            hand.onDragInGravityMode = null;
        }
        this._updateShakeClass();
    }

    _updateShakeClass() {
        this.element.classList.toggle('shake-mode', this.isShaking);
    }

    /* ---- Debug helpers ---- */

    debugDetachAll() {
        for (const hand of this.hands) hand.detach();
    }

    debugDetach(index = 2) {
        if (this.hands[index]) this.hands[index].detach();
    }

    debugSpin(index = 2, speed = 30) {
        if (this.hands[index]) this.hands[index].body.setAngularVelocity(speed);
    }

    debugSetEnergy(energy) {
        this.crown.energy = Math.max(0, Math.min(1.2, energy));
    }

    debugOverwind() {
        this.crown.energy = 0;
        this.crown.onOverwind?.();
    }

    debugCrown(show = true) {
        if (show) this.crown.reveal();
        else this.crown.hide();
    }

    /* ---- Per-frame update ---- */

    update() {
        const now = Date.now();
        const windFactor = this.crown.update();

        // Drive time-model hands (even if some hands are still in gravity)
        // Categorize hands without allocating arrays
        let timeCount = 0;
        let anyManual = false;
        let allCanCorrect = true;
        for (const hand of this.hands) {
            if (hand.isInTimeModel) {
                timeCount++;
                if (hand.wasManuallySet) anyManual = true;
                if (!hand.canCorrect) allCanCorrect = false;
            }
        }

        if (timeCount > 0) {
            if (anyManual && allCanCorrect && timeCount === this.hands.length) {
                const setTime = new Date();
                setTime.setHours(Math.floor(this.hands[0].angle / 30));
                setTime.setMinutes(Math.floor(this.hands[1].angle / 6));
                setTime.setSeconds(Math.floor(this.hands[2].angle / 6));
                setTime.setMilliseconds(0);
                this.time.value = setTime.getTime() - now;

                for (const hand of this.hands) {
                    if (hand.isInTimeModel) hand.clearManuallySet();
                }
            }

            if (windFactor < 1.0) {
                const driftRate = (1.0 - windFactor) * -2;
                this._driftAccumulator += driftRate;
                if (Math.abs(this._driftAccumulator) >= 1) {
                    const drift = Math.trunc(this._driftAccumulator);
                    this.time.value += drift;
                    this._driftAccumulator -= drift;
                }
            }

            const displayTime = new Date(now + this.time.value);
            const h = displayTime.getHours() % 12;
            const m = displayTime.getMinutes();
            const s = displayTime.getSeconds();
            const ms = displayTime.getMilliseconds();

            this.hands[0].setTargetAngle((h + m / 60) * 30);
            this.hands[1].setTargetAngle((m + s / 60) * 6);
            this.hands[2].setTargetAngle((s + ms / 1000) * 6);

            for (const hand of this.hands) {
                if (hand.isInTimeModel) hand.driveToTarget();
            }
        }

        // Coasting (time model)
        for (const hand of this.hands) hand.checkCoasting();

        // Reattach detached hands near pivot
        for (const hand of this.hands) {
            if (hand.isDetached && !hand._isDragging) {
                const basePos = hand.body.getWorldPoint(Vec2(0, 0));
                const tipPos = hand.body.getWorldPoint(Vec2(0, hand.length));
                const baseDist = basePos.length();
                const tipDist = tipPos.length();
                const speed = hand.body.getLinearVelocity().length();
                const angSpeed = Math.abs(hand.body.getAngularVelocity());
                const slow = speed < 0.5 && angSpeed < 0.5;

                if (baseDist < 0.4 && baseDist < tipDist && slow) {
                    hand.reattach();
                    hand.onDragInGravityMode = null;
                    this._updateShakeClass();
                }
            }
        }

        // Fixed-timestep accumulator — run enough steps to match real elapsed time
        const frameNow = performance.now();
        let dt = this._lastUpdateTime ? (frameNow - this._lastUpdateTime) / 1000 : TIME_STEP;
        this._lastUpdateTime = frameNow;

        // Clamp dt to avoid spiral of death after tab-switch or long pause
        if (dt > MAX_STEPS_PER_FRAME * TIME_STEP) {
            dt = MAX_STEPS_PER_FRAME * TIME_STEP;
        }
        this._physicsAccumulator += dt;

        const anyGravity = this.hands.some(h => h.isInGravityModel);
        while (this._physicsAccumulator >= TIME_STEP) {
            this.timeWorld.step(TIME_STEP);
            if (anyGravity) {
                this.gravityWorld.step(TIME_STEP);
            }
            this._physicsAccumulator -= TIME_STEP;
        }

        // Render all hands (skip when not visible)
        if (this.visible !== false) {
            if (!this._cachedClockRadius) {
                this._cachedClockRadius = this.element.clientWidth / 2;
            }
            for (const hand of this.hands) {
                hand.render(this._cachedClockRadius, WORLD_RADIUS);
            }
        }
    }
}
