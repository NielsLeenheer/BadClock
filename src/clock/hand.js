export class Hand {
    constructor(element, gearRatio, gravityPhysics = {}) {
        this.element = element;
        this.gearRatio = gearRatio;
        this.angle = 0;
        this._velocity = 0;
        this._isDragging = false;
        this._lastAngle = 0;
        this._lastTime = Date.now();
        this._damping = 0.95;
        this._manuallySet = false;

        // Gravity mode physics
        this._gravityMode = false;
        this._gravityTargetAngle = 180;
        this._gravityVelocity = 0;
        this._gravityDamping = gravityPhysics.damping || 0.99;
        this._springConstant = gravityPhysics.springConstant || 0.0025;

        // Called when user drags a hand during gravity mode
        this.onDragInGravityMode = null;

        this._setupTouch();
    }

    /** True when the hand is idle (not dragging, no velocity, not user-set). */
    get isSettled() {
        return !this._isDragging && this._velocity === 0 && !this._manuallySet;
    }

    /** True when user has dragged and released, but time hasn't been recalculated yet. */
    get wasManuallySet() {
        return this._manuallySet;
    }

    /** Mark the time recalculation as consumed. */
    clearManuallySet() {
        this._manuallySet = false;
    }

    /** True when hand can accept time correction (not being touched, no momentum). */
    get canCorrect() {
        return !this._isDragging && this._velocity === 0;
    }

    /** Nudge the angle toward a target by at most `maxStep` degrees. */
    correctToward(targetAngle, maxStep) {
        if (!this.canCorrect) return;
        const diff = _angleDifference(targetAngle, this.angle);
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    }

    /** Stop all motion and mark as user-set (for exiting gravity mode). */
    settle() {
        this._velocity = 0;
        this._manuallySet = true;
    }

    setAngle(angle) {
        this.angle = angle;
    }

    /* ---- Gravity mode ---- */

    enableGravityMode(gravityAngle) {
        this._gravityMode = true;
        this._gravityTargetAngle = gravityAngle;
        this._gravityVelocity = 0;
        this._velocity = 0;
    }

    disableGravityMode() {
        this._gravityMode = false;
        this._gravityVelocity = 0;
    }

    updateGravityTarget(gravityAngle) {
        if (this._gravityMode) {
            this._gravityTargetAngle = gravityAngle;
        }
    }

    applyClockRotationInertia(rotationChange) {
        if (this._gravityMode && Math.abs(rotationChange) > 1) {
            this.angle -= rotationChange;
        }
    }

    /* ---- Per-frame physics ---- */

    update() {
        if (this._gravityMode) {
            const diff = _angleDifference(this._gravityTargetAngle, this.angle);

            this._gravityVelocity += diff * this._springConstant;
            this.angle += this._gravityVelocity;
            this._gravityVelocity *= this._gravityDamping;

            if (Math.abs(this._gravityVelocity) < 0.03 && Math.abs(diff) < 0.5) {
                this._gravityVelocity = 0;
                this.angle = this._gravityTargetAngle;
            }
        } else if (!this._isDragging) {
            this.angle += this._velocity;
            this._velocity *= this._damping;

            if (Math.abs(this._velocity) < 0.01) {
                this._velocity = 0;
            }
        }

        while (this.angle >= 360) this.angle -= 360;
        while (this.angle < 0) this.angle += 360;

        this.element.style.transform = `translateX(-50%) rotate(${this.angle}deg)`;
    }

    /* ---- Touch handling (private) ---- */

    _setupTouch() {
        const getAngleFromEvent = (e) => {
            const touch = e.touches ? e.touches[0] : e;
            const rect = this.element.parentElement.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = touch.clientX - centerX;
            const dy = touch.clientY - centerY;
            return Math.atan2(dx, -dy) * (180 / Math.PI);
        };

        const startDrag = (e) => {
            this._isDragging = true;
            this.element.classList.add('dragging');
            this._velocity = 0;
            this._lastAngle = getAngleFromEvent(e);
            this._lastTime = Date.now();
            this._manuallySet = true;

            if (this._gravityMode && this.onDragInGravityMode) {
                this.onDragInGravityMode();
            }

            e.preventDefault();
        };

        const drag = (e) => {
            if (!this._isDragging) return;

            const currentAngle = getAngleFromEvent(e);
            const currentTime = Date.now();
            const deltaTime = currentTime - this._lastTime;

            if (deltaTime > 0) {
                let deltaAngle = currentAngle - this._lastAngle;

                if (deltaAngle > 180) deltaAngle -= 360;
                if (deltaAngle < -180) deltaAngle += 360;

                this.angle += deltaAngle;
                this._velocity = deltaAngle / deltaTime * 16;

                this._lastAngle = currentAngle;
                this._lastTime = currentTime;
            }

            e.preventDefault();
        };

        const endDrag = (e) => {
            if (!this._isDragging) return;
            this._isDragging = false;
            this.element.classList.remove('dragging');
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

function _angleDifference(target, current) {
    let diff = target - current;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
}
