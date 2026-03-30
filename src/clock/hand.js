import { Vec2, Box, RevoluteJoint } from 'planck';

const DEG = Math.PI / 180;

const CAT_ATTACHED = 0x0001;
const CAT_DETACHED = 0x0002;
const CAT_BOUNDARY = 0x0004;
const WORLD_RADIUS = 5;

export class Hand {
    /**
     * @param {HTMLElement} element
     * @param {object} worlds - { time: World, gravity: World }
     * @param {object} anchors - { anchor: Body (kinematic, time model), pivot: Body (static, gravity model) }
     * @param {object} opts
     */
    constructor(element, worlds, anchors, opts) {
        this.element = element;
        this.worlds = worlds;
        this.anchors = anchors;

        this.length = opts.length;
        this.width = opts.width ?? 0.15;
        this.density = opts.density ?? 1.0;
        this.motorTorque = opts.motorTorque ?? 5;
        this.motorGain = opts.motorGain ?? 1;

        this._targetAngle = 0;
        this._manuallySet = false;
        this._mode = 'clock';       // 'clock' | 'coasting' | 'gravity' | 'detached'
        this._orientation = 0;

        this.body = null;
        this.joint = null;

        this.onDragInGravityMode = null;
        this.onDetachDuringDrag = null;

        this._renderedTransform = null;

        // Start in time model
        this._createTimeBody();
        this._createAnchorJoint();

        this._isDragging = false;
        this._setupTouch();
    }

    /* ---- Body creation / destruction ---- */

    _bodyDef() {
        return {
            type: 'dynamic',
            position: Vec2(0, 0),
            angularDamping: 0.8,
            linearDamping: 0.3,
        };
    }

    _createFixture(body) {
        return body.createFixture(
            Box(this.width / 2, this.length / 2, Vec2(0, this.length / 2)),
            {
                density: this.density,
                friction: 0.3,
                restitution: 0.2,
                filterCategoryBits: CAT_ATTACHED,
                filterMaskBits: CAT_BOUNDARY,
                filterGroupIndex: -1,
            }
        );
    }

    _createTimeBody() {
        this.body = this.worlds.time.createBody(this._bodyDef());
        this.fixture = this._createFixture(this.body);
        this.body.setGravityScale(0);
    }

    _createGravityBody() {
        this.body = this.worlds.gravity.createBody(this._bodyDef());
        this.fixture = this._createFixture(this.body);
        this.body.setGravityScale(1);
    }

    _destroyBody(world) {
        if (this.joint) {
            world.destroyJoint(this.joint);
            this.joint = null;
        }
        if (this.body) {
            world.destroyBody(this.body);
            this.body = null;
            this.fixture = null;
        }
    }

    _createAnchorJoint() {
        this.joint = this.worlds.time.createJoint(
            RevoluteJoint(
                { enableMotor: true, maxMotorTorque: this.motorTorque, motorSpeed: 0 },
                this.anchors.anchor,
                this.body,
                Vec2(0, 0)
            )
        );
    }

    _createPivotJoint() {
        this.joint = this.worlds.gravity.createJoint(
            RevoluteJoint(
                { enableMotor: false },
                this.anchors.pivot,
                this.body,
                Vec2(0, 0)
            )
        );
    }

    /* ---- Space conversion ---- */

    _physicalToScreen(angle, pos, linVel) {
        const rad = this._orientation * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            angle: angle + this._orientation * DEG,
            pos: Vec2(pos.x * cos - pos.y * sin, pos.x * sin + pos.y * cos),
            linVel: Vec2(linVel.x * cos - linVel.y * sin, linVel.x * sin + linVel.y * cos),
        };
    }

    _screenToPhysical(angle, pos, linVel) {
        const rad = -this._orientation * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            angle: angle - this._orientation * DEG,
            pos: Vec2(pos.x * cos - pos.y * sin, pos.x * sin + pos.y * cos),
            linVel: Vec2(linVel.x * cos - linVel.y * sin, linVel.x * sin + linVel.y * cos),
        };
    }

    /* ---- Model switching ---- */

    _readState() {
        return {
            angle: this.body.getAngle(),
            pos: this.body.getPosition(),
            linVel: this.body.getLinearVelocity(),
            angVel: this.body.getAngularVelocity(),
        };
    }

    _applyState(state) {
        this.body.setTransform(state.pos, state.angle);
        this.body.setLinearVelocity(state.linVel);
        this.body.setAngularVelocity(state.angVel);
        this.body.setAwake(true);
    }

    _switchToGravityModel(mode) {
        const state = this._readState();
        const sourceWorld = this.worlds.time;
        this._destroyBody(sourceWorld);

        const converted = this._physicalToScreen(state.angle, state.pos, state.linVel);

        this._createGravityBody();
        this._applyState({
            angle: converted.angle,
            pos: converted.pos,
            linVel: converted.linVel,
            angVel: state.angVel,
        });

        this._mode = mode;

        if (mode === 'gravity') {
            this._createPivotJoint();
        } else {
            // detached — set collision filter for bouncing
            this.fixture.setFilterData({
                categoryBits: CAT_DETACHED,
                maskBits: CAT_BOUNDARY | CAT_DETACHED,
                groupIndex: 0,
            });
        }
    }

    _switchToTimeModel() {
        const state = this._readState();
        const sourceWorld = this.worlds.gravity;
        this._destroyBody(sourceWorld);

        const converted = this._screenToPhysical(state.angle, state.pos, state.linVel);

        this._createTimeBody();
        this._createAnchorJoint(); // joint at angle 0 → referenceAngle = 0

        // Set angle after joint so referenceAngle stays 0
        this.body.setTransform(Vec2(0, 0), converted.angle);
        this.body.setAwake(true);

        this._mode = 'clock';
        this._manuallySet = true;
    }

    /* ---- Getters ---- */

    get angle() {
        if (this.joint && (this._mode === 'clock' || this._mode === 'coasting')) {
            let deg = -(this.joint.getJointAngle() / DEG);
            return ((deg % 360) + 360) % 360;
        }
        let deg = -(this.body.getAngle() / DEG);
        return ((deg % 360) + 360) % 360;
    }

    get isSettled() {
        return !this._isDragging && !this._manuallySet &&
               this._mode === 'clock' &&
               Math.abs(this.body.getAngularVelocity()) < 0.05;
    }

    get wasManuallySet() {
        return this._manuallySet;
    }

    get canCorrect() {
        return !this._isDragging &&
               this._mode === 'clock' &&
               Math.abs(this.body.getAngularVelocity()) < 0.1;
    }

    get isDetached() {
        return this._mode === 'detached';
    }

    get isInGravityModel() {
        return this._mode === 'gravity' || this._mode === 'detached';
    }

    get isInTimeModel() {
        return this._mode === 'clock' || this._mode === 'coasting';
    }

    clearManuallySet() {
        this._manuallySet = false;
    }

    /* ---- Clock mode ---- */

    setAngle(deg) {
        const rad = -deg * DEG;
        this.body.setTransform(Vec2(0, 0), rad);
        this.body.setAngularVelocity(0);
        this.body.setLinearVelocity(Vec2(0, 0));
        this._targetAngle = deg;
    }

    setTargetAngle(deg) {
        this._targetAngle = deg;
    }

    driveToTarget() {
        if (this._mode !== 'clock' || !this.joint || this._isDragging || this._manuallySet) return;

        const currentRad = this.joint.getJointAngle();
        const targetRad = -this._targetAngle * DEG;

        let diff = targetRad - currentRad;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        this.joint.setMotorSpeed(diff * this.motorGain);
    }

    checkCoasting() {
        if (this._mode !== 'coasting') return;

        this.body.setPosition(Vec2(0, 0));
        this.body.setLinearVelocity(Vec2(0, 0));

        if (Math.abs(this.body.getAngularVelocity()) < 0.05) {
            this.body.setAngularVelocity(0);

            // Save angle, reset to 0 so joint gets referenceAngle = 0
            const angle = this.body.getAngle();
            this.body.setTransform(Vec2(0, 0), 0);

            // Recreate anchor joint
            this.joint = this.worlds.time.createJoint(
                RevoluteJoint(
                    { enableMotor: true, maxMotorTorque: this.motorTorque, motorSpeed: 0 },
                    this.anchors.anchor,
                    this.body,
                    Vec2(0, 0)
                )
            );

            // Restore angle after joint creation
            this.body.setTransform(Vec2(0, 0), angle);

            this._mode = 'clock';
            this._manuallySet = true;
        }
    }

    /* ---- Mode transitions ---- */

    enterGravityMode() {
        if (this.isInGravityModel) return;
        this._switchToGravityModel('gravity');
    }

    exitGravityMode() {
        if (!this.isInGravityModel) return;
        this._switchToTimeModel();
    }

    detach() {
        if (this._mode === 'detached') return;

        if (this.isInTimeModel) {
            this._switchToGravityModel('detached');
        } else {
            // Already in gravity model, just remove joint
            if (this.joint) {
                this.worlds.gravity.destroyJoint(this.joint);
                this.joint = null;
            }
            this._mode = 'detached';
            this.fixture.setFilterData({
                categoryBits: CAT_DETACHED,
                maskBits: CAT_BOUNDARY | CAT_DETACHED,
                groupIndex: 0,
            });
        }
    }

    reattach() {
        if (!this.isInGravityModel) return;
        this._switchToTimeModel();
    }

    settle() {
        this._manuallySet = true;
        this.body.setAngularVelocity(0);
        this.body.setLinearVelocity(Vec2(0, 0));
    }

    _startCoasting(velocityDegSec) {
        // Coasting stays in time model — destroy joint, spin freely
        if (this.joint) {
            this.worlds.time.destroyJoint(this.joint);
            this.joint = null;
        }
        this._mode = 'coasting';
        this.body.setAngularVelocity(-velocityDegSec * DEG);
        this.body.setLinearVelocity(Vec2(0, 0));
    }

    /* ---- Rendering ---- */

    render(clockRadius, worldRadius) {
        const scale = clockRadius / worldRadius;

        let transform;

        if (this._mode === 'detached') {
            // Gravity model (screen space) → DOM (physical space)
            const pos = this.body.getPosition();
            const bodyDeg = -this.body.getAngle() / DEG;

            // Convert planck screen position to CSS face position:
            // 1. Rotate by +orientation in planck convention (inverse of #clock's CSS rotation)
            // 2. Flip Y for CSS (+Y down)
            const rad = this._orientation * DEG;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const rx = pos.x * cos - pos.y * sin;
            const ry = pos.x * sin + pos.y * cos;
            const px = rx * scale;
            const py = -ry * scale;
            const renderDeg = bodyDeg - this._orientation;

            transform =
                `translate(calc(-50% + ${px.toFixed(1)}px), ${py.toFixed(1)}px) rotate(${renderDeg.toFixed(1)}deg)`;
        } else if (this._mode === 'gravity') {
            // Gravity model (screen space) → DOM (physical space)
            const bodyDeg = -this.body.getAngle() / DEG;
            const renderDeg = bodyDeg - this._orientation;
            transform = `translateX(-50%) rotate(${renderDeg.toFixed(1)}deg)`;
        } else {
            // Time model (physical space) → DOM (physical space): direct
            // Quantize to 0.01° — sub-pixel for hour/minute, smooth for second
            const deg = Math.round(this.angle * 100) / 100;
            transform = `translateX(-50%) rotate(${deg}deg)`;
        }

        if (transform !== this._renderedTransform) {
            this.element.style.transform = transform;
            this._renderedTransform = transform;
        }
    }

    /* ---- Touch handling ---- */

    _setupTouch() {
        const getScreenAngleFromEvent = (e) => {
            const touch = e.touches ? e.touches[0] : e;
            const face = this.element.closest('#analog-face');
            const rect = face.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            return Math.atan2(touch.clientX - cx, -(touch.clientY - cy)) * (180 / Math.PI);
        };

        // Convert screen angle to time model (physical) angle
        const screenToModelAngle = (screenAngle) => {
            if (this.isInTimeModel) {
                return screenAngle - this._orientation;
            }
            return screenAngle; // gravity model is screen space
        };

        const getWorldPosFromEvent = (e) => {
            const touch = e.touches ? e.touches[0] : e;
            const face = this.element.closest('#analog-face');
            const rect = face.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const scale = face.offsetWidth / 2 / 5;

            // Screen offset from center
            const sx = (touch.clientX - cx) / scale;
            const sy = -(touch.clientY - cy) / scale;

            // Gravity model is screen space — direct
            return Vec2(sx, sy);
        };

        let trackedVelocity = 0;
        let lastDragPos = Vec2(0, 0);
        let trackedLinearVel = Vec2(0, 0);
        let dragPosOffset = Vec2(0, 0);
        let wasModeBeforeDrag = 'clock';

        // Ring buffer for frequency-independent velocity estimation
        const SAMPLE_WINDOW = 100; // ms — use samples from this recent window
        const angleSamples = [];   // { time, angle }
        const posSamples = [];     // { time, x, y }

        const addAngleSample = (time, angle) => {
            angleSamples.push({ time, angle });
            while (angleSamples.length > 0 && time - angleSamples[0].time > SAMPLE_WINDOW * 2) {
                angleSamples.shift();
            }
        };

        const addPosSample = (time, x, y) => {
            posSamples.push({ time, x, y });
            while (posSamples.length > 0 && time - posSamples[0].time > SAMPLE_WINDOW * 2) {
                posSamples.shift();
            }
        };

        const getAngularVelocity = (now) => {
            // Find oldest sample within SAMPLE_WINDOW
            let oldest = null;
            for (const s of angleSamples) {
                if (now - s.time <= SAMPLE_WINDOW) { oldest = s; break; }
            }
            const newest = angleSamples[angleSamples.length - 1];
            if (!oldest || !newest || oldest === newest) return 0;
            const dt = newest.time - oldest.time;
            if (dt < 8) return 0; // need at least ~8ms span
            let delta = newest.angle - oldest.angle;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            return (delta / dt) * 1000; // deg/sec
        };

        const getLinearVelocity = (now) => {
            let oldest = null;
            for (const s of posSamples) {
                if (now - s.time <= SAMPLE_WINDOW) { oldest = s; break; }
            }
            const newest = posSamples[posSamples.length - 1];
            if (!oldest || !newest || oldest === newest) return Vec2(0, 0);
            const dt = newest.time - oldest.time;
            if (dt < 8) return Vec2(0, 0);
            return Vec2(
                (newest.x - oldest.x) / dt * 1000,
                (newest.y - oldest.y) / dt * 1000,
            );
        };

        const startDrag = (e) => {
            this._isDragging = true;
            this._manuallySet = true;
            wasModeBeforeDrag = this._mode;

            const screenAngle = getScreenAngleFromEvent(e);
            const modelAngle = screenToModelAngle(screenAngle);
            this._dragOffset = this.angle - modelAngle;
            this._lastDragTime = performance.now();
            angleSamples.length = 0;
            posSamples.length = 0;

            // 1-in-50 chance the hand detaches when picked up from time model
            if (this.isInTimeModel && (Hand.forceDetachOnDrag || Math.random() < 1 / 10)) {
                // Destroy joint before switching
                if (this.joint) {
                    this.worlds.time.destroyJoint(this.joint);
                    this.joint = null;
                }
                this._switchToGravityModel('detached');
                wasModeBeforeDrag = 'detached';
                this.fixture.setFilterData({
                    categoryBits: CAT_DETACHED,
                    maskBits: CAT_BOUNDARY | CAT_DETACHED,
                    groupIndex: 0,
                });
                if (this.onDetachDuringDrag) this.onDetachDuringDrag();
            }

            if (wasModeBeforeDrag === 'detached') {
                const worldPos = getWorldPosFromEvent(e);
                const bodyPos = this.body.getPosition();
                dragPosOffset = Vec2(bodyPos.x - worldPos.x, bodyPos.y - worldPos.y);
                lastDragPos = Vec2(bodyPos.x, bodyPos.y);
                trackedLinearVel = Vec2(0, 0);
            }

            this.element.classList.add('dragging');

            // Destroy joint for dragging
            if (this.joint) {
                const world = this.isInTimeModel ? this.worlds.time : this.worlds.gravity;
                world.destroyJoint(this.joint);
                this.joint = null;
            }
            this.body.setAngularVelocity(0);
            this.body.setLinearVelocity(Vec2(0, 0));
            this.body.setGravityScale(0);

            e.preventDefault();
        };

        const drag = (e) => {
            if (!this._isDragging) return;

            if (wasModeBeforeDrag === 'detached') {
                const worldPos = getWorldPosFromEvent(e);
                const newPos = Vec2(
                    worldPos.x + dragPosOffset.x,
                    worldPos.y + dragPosOffset.y
                );

                // Clamp position inside the boundary circle
                const dist = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y);
                const maxR = WORLD_RADIUS - 0.3;
                if (dist > maxR) {
                    const s = maxR / dist;
                    newPos.x *= s;
                    newPos.y *= s;
                }

                this.body.setTransform(newPos, this.body.getAngle());
                this.body.setLinearVelocity(Vec2(0, 0));
                this.body.setAngularVelocity(0);

                const now = performance.now();
                addPosSample(now, newPos.x, newPos.y);
                this._lastDragTime = now;
            } else {
                const screenAngle = getScreenAngleFromEvent(e);
                const modelAngle = screenToModelAngle(screenAngle);
                const targetDeg = modelAngle + this._dragOffset;
                const targetRad = -targetDeg * DEG;

                this.body.setTransform(Vec2(0, 0), targetRad);
                this.body.setAngularVelocity(0);
                this.body.setLinearVelocity(Vec2(0, 0));

                const now = performance.now();
                addAngleSample(now, modelAngle);
                this._lastDragTime = now;
            }

            e.preventDefault();
        };

        const endDrag = (e) => {
            if (!this._isDragging) return;
            this._isDragging = false;
            this._lastModelAngle = null;
            this.element.classList.remove('dragging');

            const now = performance.now();
            const timeSinceMove = now - this._lastDragTime;
            const releaseVel = timeSinceMove < 150 ? getAngularVelocity(now) : 0;

            // Flick detach (from time model)
            if (Math.abs(releaseVel) > 1250 && wasModeBeforeDrag !== 'detached' && wasModeBeforeDrag !== 'gravity') {
                // Convert body state to gravity model and detach
                const angVelRad = -releaseVel * DEG;
                const handAngle = this.body.getAngle();
                const tipX = -Math.sin(handAngle) * this.length;
                const tipY = Math.cos(handAngle) * this.length;
                const speed = Math.abs(angVelRad) * this.length;
                const direction = Math.sign(angVelRad);
                const tanX = -tipY / this.length * direction;
                const tanY = tipX / this.length * direction;

                // Body is in time model — switch to gravity
                const bodyAngle = this.body.getAngle();
                this._destroyBody(this.worlds.time);

                const converted = this._physicalToScreen(
                    bodyAngle, Vec2(0, 0), Vec2(tanX * speed, tanY * speed)
                );

                this._createGravityBody();
                this.body.setTransform(converted.pos, converted.angle);
                this.body.setLinearVelocity(converted.linVel);
                this.body.setAngularVelocity(angVelRad);
                this.body.setAwake(true);

                this._mode = 'detached';
                this.fixture.setFilterData({
                    categoryBits: CAT_DETACHED,
                    maskBits: CAT_BOUNDARY | CAT_DETACHED,
                    groupIndex: 0,
                });

                e.preventDefault();
                return;
            }

            // Release detached hand — throw with velocity
            if (wasModeBeforeDrag === 'detached') {
                this._mode = 'detached';
                this.body.setGravityScale(1);
                this.body.setAwake(true);
                this.fixture.setFilterData({
                    categoryBits: CAT_DETACHED,
                    maskBits: CAT_BOUNDARY | CAT_DETACHED,
                    groupIndex: 0,
                });
                if (timeSinceMove < 150) {
                    const linVel = getLinearVelocity(now);
                    this.body.setLinearVelocity(linVel);
                }
                e.preventDefault();
                return;
            }

            // Release gravity mode hand — transition to time model
            if (wasModeBeforeDrag === 'gravity') {
                // Body is still in gravity world, switch to time model
                this._mode = 'gravity'; // restore mode so _switchToTimeModel reads from correct world
                this._switchToTimeModel();
                // If released with enough angular velocity, go straight to coasting
                if (Math.abs(releaseVel) > 80) {
                    this._startCoasting(releaseVel);
                }
                if (this.onDragInGravityMode) this.onDragInGravityMode();
                e.preventDefault();
                return;
            }

            // Normal release in time model — coast or drop into gravity
            this._manuallySet = true;

            // Chance to enter gravity mode (attached) on a moderate flick
            if (Math.abs(releaseVel) > 200 && Math.random() < 1 / 20) {
                // Switch to gravity model but keep pivot joint — hand swings under gravity
                this._switchToGravityModel('gravity');
                this._createPivotJoint();
                this.body.setAngularVelocity(-releaseVel * DEG);
                if (this.onDragInGravityMode) this.onDragInGravityMode();
                e.preventDefault();
                return;
            }

            this._startCoasting(releaseVel);

            e.preventDefault();
        };

        this.element.addEventListener('touchstart', startDrag);
        this.element.addEventListener('mousedown', startDrag);
        document.addEventListener('touchmove', drag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('touchend', endDrag);
        document.addEventListener('mouseup', endDrag);
    }
}

Hand.forceDetachOnDrag = false;

export { CAT_BOUNDARY };
