import { Vec2, Circle } from 'planck';

const CAT_BEAN = 0x0008;
const CAT_BOUNDARY = 0x0004;
const CAT_DETACHED = 0x0002;

const BEAN_COUNT = 120;
const BEAN_RADIUS_MIN = 0.18;
const BEAN_RADIUS_MAX = 0.25;
const BEAN_COLORS = [
    '#c0541e', '#b34a18', '#d4622a', '#a84015', '#cc5820',
    '#e87830', '#d06828', '#b85020',
];
const SAUCE_COLOR = 'rgba(160, 45, 12, 0.75)';
const SAUCE_FILL_RATIO = 0.35; // sauce fills bottom 35% of the circle

export class Beans {
    constructor(faceElement, gravityWorld, worldRadius) {
        this.world = gravityWorld;
        this.worldRadius = worldRadius;
        this.bodies = [];
        this.active = false;
        this._orientation = 0;

        // Sauce body — kinematic, pivots at center, smoothly tracks gravity
        this.sauceBody = gravityWorld.createBody({
            type: 'kinematic',
            position: Vec2(0, 0),
        });
        this._sauceAngle = 0;         // current rendered angle
        this._sauceVelocity = 0;      // angular velocity for spring-damper
        this._sauceTargetAngle = 0;
        this._waveAmplitude = 0;      // current wave height (fraction of R)
        this._wavePhase = 0;          // phase offset for animation

        // Canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = `
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none; z-index: 4;
        `;
        faceElement.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Offscreen canvas for sauce coating (film left on glass)
        this._coatingCanvas = document.createElement('canvas');
        this._coatingCtx = this._coatingCanvas.getContext('2d');

        // Offscreen canvas for compositing sauce shape (pool + bean blobs)
        this._sauceShapeCanvas = document.createElement('canvas');
        this._sauceShapeCtx = this._sauceShapeCanvas.getContext('2d');

        // Assign each bean a color at creation time
        this._beanColors = [];

        // Track canvas size
        this._resize();
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => this._resize()).observe(faceElement);
        }
    }

    _resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const size = parent.clientWidth;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = size * dpr;
        this.canvas.height = size * dpr;
        this._coatingCanvas.width = size * dpr;
        this._coatingCanvas.height = size * dpr;
        this._sauceShapeCanvas.width = size * dpr;
        this._sauceShapeCanvas.height = size * dpr;
        this._canvasSize = size;
        this._dpr = dpr;
    }

    setOrientation(degrees) {
        const oldOrientation = this._orientation;
        this._orientation = degrees;

        // The canvas is inside #clock which has CSS rotate(orientation°).
        // Sauce drawn at canvas-bottom automatically appears at screen-bottom
        // after CSS rotation — so target is always 0.
        // When orientation changes, kick the sauce angle by the delta so it
        // appears to stay in place momentarily, then spring-damper pulls to 0.
        const delta = (degrees - oldOrientation) * Math.PI / 180;
        this._sauceAngle -= delta;
        this._sauceTargetAngle = 0;

        // Wake up bean bodies so they respond to new gravity
        for (const body of this.bodies) {
            body.setAwake(true);
        }
    }

    pour() {
        if (this.active) return;
        this.active = true;

        // Snap sauce angle to current target immediately on pour
        this._sauceAngle = this._sauceTargetAngle;
        this._sauceVelocity = 0;

        // Place beans at the bottom of the circle (gravity direction)
        const gravRad = this._orientation * Math.PI / 180;
        // "Down" in world space for this orientation
        const downX = -Math.sin(gravRad);
        const downY = -Math.cos(gravRad);
        // Cross axis (perpendicular to down)
        const crossX = -downY;
        const crossY = downX;
        const R = this.worldRadius;

        for (let i = 0; i < BEAN_COUNT; i++) {
            const r = BEAN_RADIUS_MIN + Math.random() * (BEAN_RADIUS_MAX - BEAN_RADIUS_MIN);

            // Place in the bottom portion, scattered across the width
            const depth = 0.15 + Math.random() * 0.7;
            const spread = (Math.random() - 0.5) * 1.6;

            let x = downX * depth * R * 0.8 + crossX * spread * R * 0.5;
            let y = downY * depth * R * 0.8 + crossY * spread * R * 0.5;

            // Clamp inside circle
            const dist = Math.sqrt(x * x + y * y);
            if (dist > R - r * 2) {
                const s = (R - r * 2) / dist;
                x *= s;
                y *= s;
            }

            const body = this.world.createBody({
                type: 'dynamic',
                position: Vec2(x, y),
                angle: Math.random() * Math.PI * 2,
                angularDamping: 5,
                linearDamping: 6,
            });

            body.createFixture(Circle(r * 1.15), {
                density: 1.2,
                friction: 0.05,
                restitution: 0.15,
                filterCategoryBits: CAT_BEAN,
                filterMaskBits: CAT_BOUNDARY | CAT_BEAN | CAT_DETACHED,
            });

            body._beanRadius = r;
            this.bodies.push(body);
            this._beanColors.push(BEAN_COLORS[Math.floor(Math.random() * BEAN_COLORS.length)]);
        }
    }

    clear() {
        for (const body of this.bodies) {
            this.world.destroyBody(body);
        }
        this.bodies = [];
        this._beanColors = [];
        this.active = false;

        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this._coatingCtx.clearRect(0, 0, this._coatingCanvas.width, this._coatingCanvas.height);
        }
    }

    render(clockRadius, worldRadius) {
        if (!this.active || this.bodies.length === 0) return;

        // Spring-damper sauce sloshing (semi-implicit Euler)
        const angleDiff = this._sauceTargetAngle - this._sauceAngle;
        const wrapped = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        const dt = 1 / 60;
        // Slow, droopy sauce: springK=4, damping=3 → ~1.6s period, underdamped
        const springK = 1.5;
        const damping = 2;
        this._sauceVelocity += (wrapped * springK - this._sauceVelocity * damping) * dt;
        this._sauceAngle += this._sauceVelocity * dt;
        this.sauceBody.setTransform(Vec2(0, 0), this._sauceAngle);

        // Wave amplitude tracks sauce velocity, settles to a gentle ripple at rest
        const speed = Math.abs(this._sauceVelocity);
        const targetAmp = Math.max(0.008, Math.min(speed * 0.06, 0.08));
        this._waveAmplitude += (targetAmp - this._waveAmplitude) * 0.05;
        this._wavePhase += speed * 0.3 + 0.02;

        const ctx = this.ctx;
        const dpr = this._dpr;
        const size = this._canvasSize * dpr;
        const scale = (clockRadius * dpr) / worldRadius;
        const cx = size / 2;
        const cy = size / 2;
        const R = clockRadius * dpr;

        ctx.clearRect(0, 0, size, size);

        // Pre-compute orientation rotation (screen-space → CSS-space)
        // Same transform as hand.js detached render:
        // rotate by +orientation, flip Y for CSS
        const orientRad = this._orientation * Math.PI / 180;
        const oCos = Math.cos(orientRad);
        const oSin = Math.sin(orientRad);

        // Update sauce coating layer (film on glass) — uses sauce shape
        // Build it first, then stamp onto coating, then draw everything

        // Build sauce shape: pool + circles around each bean (solid, opaque)
        const sctx = this._sauceShapeCtx;
        sctx.clearRect(0, 0, size, size);

        // 1. Draw the sauce pool base (solid opaque)
        this._drawSaucePool(sctx, cx, cy, R, '#a02d0c');

        // 2. Draw oval sauce blobs around each bean (matching bean orientation)
        sctx.fillStyle = '#a02d0c';
        for (let i = 0; i < this.bodies.length; i++) {
            const body = this.bodies[i];
            const pos = body.getPosition();
            const angle = body.getAngle();
            const r = body._beanRadius;

            const rx = pos.x * oCos - pos.y * oSin;
            const ry = pos.x * oSin + pos.y * oCos;
            const sx = cx + rx * scale;
            const sy = cy - ry * scale;
            const sr = r * scale;
            const sauceAngle = -angle - orientRad;

            sctx.beginPath();
            sctx.ellipse(sx, sy, sr * 2.2, sr * 1.3, sauceAngle, 0, Math.PI * 2);
            sctx.fill();
        }

        // 3. Clip sauce shape to the clock circle
        sctx.save();
        sctx.globalCompositeOperation = 'destination-in';
        sctx.beginPath();
        sctx.arc(cx, cy, R, 0, Math.PI * 2);
        sctx.fill();
        sctx.restore();

        // Stamp sauce shape onto coating trail
        this._updateCoating(size);

        // Draw coating behind everything
        ctx.drawImage(this._coatingCanvas, 0, 0);

        // Draw opaque sauce shape behind beans (at 75% opacity)
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.drawImage(this._sauceShapeCanvas, 0, 0);
        ctx.restore();

        // Draw beans
        for (let i = 0; i < this.bodies.length; i++) {
            const body = this.bodies[i];
            const pos = body.getPosition();
            const angle = body.getAngle();
            const r = body._beanRadius;

            // Physics (screen-space) → canvas (rotated by CSS orientation)
            const rx = pos.x * oCos - pos.y * oSin;
            const ry = pos.x * oSin + pos.y * oCos;
            const sx = cx + rx * scale;
            const sy = cy - ry * scale; // flip Y
            const sr = r * scale;
            const renderAngle = -angle - orientRad;

            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(renderAngle);
            ctx.globalAlpha = 0.85;

            // Bean shape: kidney-bean ellipse
            ctx.beginPath();
            ctx.ellipse(0, 0, sr * 1.35, sr * 0.8, 0, 0, Math.PI * 2);
            ctx.fillStyle = this._beanColors[i];
            ctx.fill();

            // Light side
            ctx.beginPath();
            ctx.ellipse(-sr * 0.15, -sr * 0.15, sr * 0.6, sr * 0.35, -0.3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 200, 150, 0.2)';
            ctx.fill();

            // Dark crease line
            ctx.beginPath();
            ctx.ellipse(0, sr * 0.05, sr * 0.9, sr * 0.08, 0, 0, Math.PI);
            ctx.fillStyle = 'rgba(80, 20, 0, 0.25)';
            ctx.fill();

            ctx.restore();
        }

        // Draw translucent sauce on top so beans look submerged
        // Re-use sauce shape canvas with reduced opacity
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.drawImage(this._sauceShapeCanvas, 0, 0);
        ctx.restore();
    }

    _updateCoating(size) {
        const cctx = this._coatingCtx;

        // Fade existing coating
        cctx.save();
        cctx.globalCompositeOperation = 'destination-out';
        cctx.fillStyle = 'rgba(0, 0, 0, 0.012)';
        cctx.fillRect(0, 0, size, size);
        cctx.restore();

        // Only stamp when sauce is displaced or beans are moving (stirring)
        const beansMoving = this.bodies.some(b => b.getLinearVelocity().lengthSquared() > 0.5);
        if (Math.abs(this._sauceAngle) > 0.02 || Math.abs(this._sauceVelocity) > 0.05 || beansMoving) {
            cctx.save();
            cctx.globalAlpha = 0.012;
            cctx.drawImage(this._sauceShapeCanvas, 0, 0);
            cctx.restore();
        }
    }

    _drawSaucePool(ctx, cx, cy, R, color) {
        // Sauce angle from the kinematic body (smoothly sloshing)
        const sauceAngle = this._sauceAngle;

        // The sauce fills the bottom portion of the circle.
        // We draw in a rotated coordinate system where "down" = +y on canvas.
        // sauceLevel: distance from center to the sauce surface line, as fraction of R
        // 0 = center, 1 = edge. Negative = above center.
        const sauceLevel = 1 - SAUCE_FILL_RATIO * 2; // 0.45 → 0.1
        const lineY = sauceLevel * R;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(sauceAngle);

        if (lineY >= R) { ctx.restore(); return; }

        const halfChord = Math.sqrt(R * R - lineY * lineY);

        // Build path: wavy surface line + arc through the bottom
        ctx.beginPath();
        ctx.moveTo(-halfChord, lineY);

        // Wave surface — two superimposed sine waves for organic feel
        const amp = this._waveAmplitude * R;
        const segments = 48;
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const wx = -halfChord + t * 2 * halfChord;
            const wave = Math.sin(t * Math.PI * 3 + this._wavePhase) * amp
                       + Math.sin(t * Math.PI * 5 - this._wavePhase * 1.3) * amp * 0.4;
            ctx.lineTo(wx, lineY + wave);
        }

        // Arc from right end of chord, through bottom, to left end of chord
        const arcStart = Math.atan2(lineY, halfChord);
        const arcEnd = Math.atan2(lineY, -halfChord);
        ctx.arc(0, 0, R, arcStart, arcEnd, false);
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.fill();

        ctx.restore();
    }

    /**
     * Test whether a point (in world-space, same coords as hand bodies)
     * is submerged below the sauce surface line.
     */
    isSubmerged(x, y) {
        if (!this.active) return false;
        const R = this.worldRadius;
        // Rotate point into sauce-local frame (sauce rotates by _sauceAngle)
        const a = this._sauceAngle;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        // Sauce is drawn in canvas space where +y = down, but world space has +y = up.
        // The sauce pool line in canvas coords is at lineY = (1 - FILL*2) * R from center.
        // In world-space (y-up), "below the line" means y < -lineY_worldSpace.
        // Rotate point into sauce frame:
        const lx = x * cosA + y * sinA;
        const ly = -x * sinA + y * cosA;
        // In sauce-local frame (y-up), the sauce surface is at:
        const sauceLevel = -(1 - SAUCE_FILL_RATIO * 2) * R;
        return ly < sauceLevel;
    }
}
