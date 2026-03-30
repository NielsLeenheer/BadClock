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
    constructor(element, time) {
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
            this._grinding = true;
            const hourHand = this.hands[0];   // index 0 = hour hand
            const secondHand = this.hands[2]; // index 2 = second hand

            // Freeze each hand's current angle and assign random vibration params
            const initGrindParams = () => {
                for (const hand of this.hands) {
                    if (hand.isInTimeModel) {
                        hand._grindBaseAngle = hand.body.getAngle();
                        hand._grindAmplitude = (10 + Math.random() * 10) * DEG;
                        hand._grindFrequency = 8 + Math.random() * 12;
                        hand._grindPhase = Math.random() * Math.PI * 2;
                        hand._grindNoise1 = 3 + Math.random() * 7;
                        hand._grindNoise2 = 17 + Math.random() * 23;
                    }
                }
            };

            const applyVibration = (elapsed, duration, skipHand = null) => {
                const t = elapsed * 0.001;
                for (const hand of this.hands) {
                    if (hand === skipHand) continue;
                    if (hand.isInTimeModel && hand._grindBaseAngle !== undefined) {
                        const intensity = 0.3 + 0.7 * (elapsed / duration);
                        // Main oscillation + two noise layers for erratic feel
                        const main = Math.sin(t * hand._grindFrequency * Math.PI * 2 + hand._grindPhase);
                        const noise1 = Math.sin(t * hand._grindNoise1 * Math.PI * 2) * 0.5;
                        const noise2 = Math.sin(t * hand._grindNoise2 * Math.PI * 2) * 0.3;
                        const combined = Math.max(-1, Math.min(1, main + noise1 * noise2));
                        const offset = combined * hand._grindAmplitude * intensity;
                        hand.body.setTransform(Vec2(0, 0), hand._grindBaseAngle + offset);
                        hand.body.setAngularVelocity(0);
                    }
                }
            };

            const cleanupGrindParams = () => {
                for (const hand of this.hands) {
                    if (hand._grindBaseAngle !== undefined) {
                        hand.body.setTransform(Vec2(0, 0), hand._grindBaseAngle);
                        hand.body.setAngularVelocity(0);
                        delete hand._grindBaseAngle;
                        delete hand._grindAmplitude;
                        delete hand._grindFrequency;
                        delete hand._grindPhase;
                        delete hand._grindNoise1;
                        delete hand._grindNoise2;
                    }
                }
            };

            const ejectHands = () => {
                this._grinding = false;
                let delay = 0;
                for (const hand of this.hands) {
                    if (hand.isInTimeModel) {
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
                        hand.detach();
                        hand.body.setLinearVelocity(Vec2(
                            (Math.random() - 0.5) * 4,
                            3 + Math.random() * 3
                        ));
                    }
                }
                this._updateShakeClass();
            };

            // Phase 1: Initial grinding (1s)
            initGrindParams();
            const phase1Start = performance.now();
            const phase1Duration = 1000;

            const phase1Frame = () => {
                const elapsed = performance.now() - phase1Start;
                if (elapsed >= phase1Duration || !this._grinding) {
                    cleanupGrindParams();
                    startSlip();
                    return;
                }
                applyVibration(elapsed, phase1Duration, hourHand);
                requestAnimationFrame(phase1Frame);
            };

            // Phase 2: Second hand slips forward through gears
            const startSlip = () => {
                if (!secondHand.isInTimeModel) { startPhase3(); return; }

                const slipStart = performance.now();
                const slipDuration = 400;
                const slipAmount = -(30 + Math.random() * 60) * DEG; // slip 30–90° forward
                const slipBaseAngle = secondHand.body.getAngle();

                const slipFrame = () => {
                    const elapsed = performance.now() - slipStart;
                    if (elapsed >= slipDuration || !this._grinding) {
                        secondHand.body.setTransform(Vec2(0, 0), slipBaseAngle + slipAmount);
                        secondHand.body.setAngularVelocity(0);
                        startPhase3();
                        return;
                    }
                    // Ease-out slip
                    const t = elapsed / slipDuration;
                    const eased = 1 - (1 - t) * (1 - t);
                    secondHand.body.setTransform(Vec2(0, 0), slipBaseAngle + slipAmount * eased);
                    secondHand.body.setAngularVelocity(0);

                    // Other hands: small tremor during slip
                    const tremT = elapsed * 0.001;
                    for (const hand of this.hands) {
                        if (hand !== secondHand && hand.isInTimeModel) {
                            const freq = hand === hourHand ? 6 : 35;
                            const amp = hand === hourHand ? 3 : 1.5;
                            const tremor = Math.sin(tremT * freq * Math.PI * 2) * amp * DEG;
                            const baseAngle = hand._grindBaseAngle ?? hand.body.getAngle();
                            hand.body.setTransform(Vec2(0, 0), baseAngle + tremor);
                            hand.body.setAngularVelocity(0);
                        }
                    }
                    requestAnimationFrame(slipFrame);
                };

                requestAnimationFrame(slipFrame);
            };

            // Phase 3: Final grinding — more violent (1.2s), then eject
            const startPhase3 = () => {
                initGrindParams();
                // Increase amplitude for final grind
                for (const hand of this.hands) {
                    if (hand._grindAmplitude !== undefined) {
                        if (hand === hourHand) {
                            // Match phase 2 hour hand: slow and heavy
                            hand._grindFrequency = 6;
                            hand._grindAmplitude = 3 * DEG * 1.5;
                        } else {
                            hand._grindAmplitude *= 1.5;
                            hand._grindFrequency *= 1.3;
                        }
                    }
                }

                const phase3Start = performance.now();
                const phase3Duration = 1200;

                const phase3Frame = () => {
                    const elapsed = performance.now() - phase3Start;
                    if (elapsed >= phase3Duration || !this._grinding) {
                        cleanupGrindParams();
                        ejectHands();
                        return;
                    }
                    applyVibration(elapsed, phase3Duration);
                    requestAnimationFrame(phase3Frame);
                };

                requestAnimationFrame(phase3Frame);
            };

            requestAnimationFrame(phase1Frame);
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

    get hasShakeableHands() {
        return this.hands.some(h => h.isInTimeModel);
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
