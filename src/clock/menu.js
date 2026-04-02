import './menu.css';
import { World, Vec2, Box, Circle, Chain } from 'planck';

const DEG = Math.PI / 180;
const WORLD_RADIUS = 5;
const GRAVITY = 15;
const TIME_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

const BUTTON_WIDTH = 3.2;   // world units
const BUTTON_HEIGHT = 0.55;
const CLOSE_RADIUS = 0.45;  // slightly larger than pill height

const MENU_ITEMS = [
    { label: 'Reset',  action: 'reset',  modes: ['digital', 'analog'] },
    { label: 'Shake',  action: 'shake',  modes: ['analog'] },
    { label: 'Beans',  action: 'beans',  modes: ['analog'] },
    { label: 'Random', action: 'random', modes: ['digital', 'analog'] },
];

export class Menu {
    constructor(clockElement) {
        this.clockElement = clockElement;
        this.active = false;
        this._orientation = 0;
        this._bodies = [];
        this._elements = [];
        this._overlay = null;
        this._world = null;
        this._animFrame = null;
        this._lastTime = 0;
        this._accumulator = 0;

        this.onAction = null; // callback(action)
    }

    open(mode = 'analog') {
        if (this.active || this._closing) return;
        this.active = true;
        this._mode = mode;

        const items = MENU_ITEMS.filter(item => item.modes.includes(mode));

        // Create overlay
        this._overlay = document.createElement('div');
        this._overlay.className = 'menu-overlay';
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close();
        });
        this._overlay.addEventListener('touchend', (e) => {
            if (e.target === this._overlay) {
                e.preventDefault();
                this.close();
            }
        });
        this.clockElement.appendChild(this._overlay);

        // Create physics world
        this._world = World(Vec2(0, -GRAVITY));
        this._updateGravity();

        // Start with a half-circle bowl (bottom half relative to gravity),
        // then swap for a full circle once all bodies are inside
        this._boundary = this._world.createBody({ type: 'static' });
        this._boundaryReady = false;
        this._createBowl();

        // Create button bodies & DOM elements
        this._bodies = [];
        this._elements = [];

        // Spawn direction: opposite to gravity (i.e., "up" in current orientation)
        const rad = this._orientation * DEG;
        const upX = Math.sin(rad);   // unit vector pointing "up" relative to gravity
        const upY = Math.cos(rad);

        // Close button — spawns first (lowest, enters circle first)
        {
            const spawnDist = WORLD_RADIUS + CLOSE_RADIUS * 2 + 0.5;
            const x = upX * spawnDist;
            const y = upY * spawnDist;

            const body = this._world.createDynamicBody({
                position: Vec2(x, y),
                angle: 0,
                linearDamping: 0.3,
                angularDamping: 0.8,
            });
            body.createFixture(Circle(CLOSE_RADIUS), {
                density: 2.5,
                friction: 0.6,
                restitution: 0.15,
            });

            const el = document.createElement('button');
            el.className = 'menu-close-button';

            const bg = document.createElement('div');
            bg.className = 'menu-close-bg';

            const icon = document.createElement('span');
            icon.className = 'menu-close-icon';
            icon.innerHTML = '&#x2715;'; // ✕

            el.appendChild(bg);
            el.appendChild(icon);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
            el.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            });
            this._overlay.appendChild(el);

            this._closeBody = body;
            this._closeElement = el;
            this._closeBg = bg;
            this._closeIcon = icon;
        }

        // Menu item pills — spawn above the close button
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Spread perpendicular to "up", stagger along "up"
            const perp = (Math.random() - 0.5) * 6.0;
            const along = WORLD_RADIUS + CLOSE_RADIUS * 2 + 1.5 + i * (0.8 + Math.random() * 0.6);
            const x = upX * along + (-upY) * perp;
            const y = upY * along + upX * perp;

            const body = this._world.createDynamicBody({
                position: Vec2(x, y),
                angle: (Math.random() - 0.5) * 0.6,
                linearDamping: 0.3,
                angularDamping: 0.8,
            });
            body.createFixture(Box(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2), {
                density: 2.0,
                friction: 0.6,
                restitution: 0.15,
            });

            const el = document.createElement('button');
            el.className = mode === 'digital' ? 'menu-button menu-button--segment' : 'menu-button';
            el.textContent = item.label;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onAction?.(item.action);
                this.close();
            });
            el.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.onAction?.(item.action);
                this.close();
            });
            this._overlay.appendChild(el);

            this._bodies.push(body);
            this._elements.push(el);
        }

        // Start animation
        this._lastTime = performance.now();
        this._accumulator = 0;
        this._animate();
    }

    close() {
        if (!this.active) return;
        this.active = false;
        this._closing = true;

        // Disable button interaction
        for (const el of this._elements) {
            el.style.pointerEvents = 'none';
        }
        if (this._closeElement) {
            this._closeElement.style.pointerEvents = 'none';
        }

        // Make pills light and undamped so they fly when hit
        for (const body of this._bodies) {
            body.setLinearDamping(0);
            body.setAngularDamping(0);
            const f = body.getFixtureList();
            if (f) f.setRestitution(1.0);
        }

        // Kill gravity immediately so pills fly freely when hit
        if (this._world) {
            this._world.setGravity(Vec2(0, 0));
        }

        // Keep boundary during bubble phases, remove later
        this._boundaryRemoved = false;

        // Pin the close button so its edge stays at the boundary contact point.
        // As the circle grows, the center moves inward.
        if (this._closeBody) {
            const pos = this._closeBody.getPosition();
            const dist = pos.length() || 1;
            // Store the radial direction (unit vector from center to contact point)
            this._closeContactDir = Vec2(pos.x / dist, pos.y / dist);
            // Position center so edge touches boundary: center = (R - r) along radial
            this._closeBody.setTransform(
                Vec2(
                    this._closeContactDir.x * (WORLD_RADIUS - CLOSE_RADIUS),
                    this._closeContactDir.y * (WORLD_RADIUS - CLOSE_RADIUS)
                ),
                this._closeBody.getAngle()
            );
            this._closeBody.setType('kinematic');
            this._closeBody.setLinearVelocity(Vec2(0, 0));
            this._closeBody.setAngularVelocity(0);
        }
        if (this._closeElement) {
            this._closeElement.style.pointerEvents = 'none';
        }

        // Pick a random close style
        this._closeStyle = Math.random() < 0.5 ? 'expand' : 'pop';
        this._closeExpandStart = performance.now();
        this._closeRadius = CLOSE_RADIUS;

        // Icon always scales up during phase 1
        if (this._closeIcon) {
            this._closeIcon.style.transition = 'opacity 1.0s 0.2s ease-out, transform 0.2s ease-out';
            this._closeIcon.style.opacity = '0';
            this._closeIcon.style.transform = 'scale(3)';
        }

        if (this._closeStyle === 'expand') {
            // Fade bg and overlay late (during phase 5)
            if (this._closeBg) {
                this._closeBg.style.transition = 'opacity 1.2s 1.2s ease-out';
                this._closeBg.style.opacity = '0';
            }
            if (this._overlay) {
                this._overlay.style.transition = 'background 1.2s 1.2s ease-out';
                this._overlay.style.background = 'transparent';
            }
            setTimeout(() => this._teardown(), 2600);
        } else {
            // Pop: bg shrinks and fades after first jiggle, overlay fades
            if (this._closeBg) {
                this._closeBg.style.transition = 'opacity 0.15s 0.6s ease-out, transform 0.15s 0.6s ease-in';
                this._closeBg.style.opacity = '0';
                this._closeBg.style.transform = 'scale(0)';
            }
            if (this._overlay) {
                this._overlay.style.transition = 'background 1.2s 0.6s ease-out';
                this._overlay.style.background = 'transparent';
            }
            setTimeout(() => this._teardown(), 2400);
        }
    }

    _teardown() {
        this._closing = false;
        this._popped = false;

        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }

        this._bodies = [];
        this._elements = [];
        this._closeBody = null;
        this._closeElement = null;
        this._closeBg = null;
        this._closeIcon = null;
        this._closeRadius = CLOSE_RADIUS;
        this._closeExpandStart = null;
        this._closeContactDir = null;
        this._boundary = null;
        this._world = null;

        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    }

    _createBowl() {
        // Half-circle arc on the gravity-down side, open at the top
        // so items can fall in from above
        // Gravity is Vec2(-G*sin(rad), -G*cos(rad)), so the "down" direction
        // in physics space points at angle atan2(-cos(rad), sin(rad)) from +X axis
        const rad = this._orientation * DEG;
        const gx = -Math.sin(rad);
        const gy = -Math.cos(rad);
        const downAngle = Math.atan2(gy, gx);
        const pts = [];
        for (let i = 0; i <= 20; i++) {
            const a = downAngle - Math.PI / 2 + (i / 20) * Math.PI;
            pts.push(Vec2(Math.cos(a) * WORLD_RADIUS, Math.sin(a) * WORLD_RADIUS));
        }
        // Clear existing fixtures
        let f = this._boundary.getFixtureList();
        while (f) {
            const next = f.getNext();
            this._boundary.destroyFixture(f);
            f = next;
        }
        this._boundary.createFixture(Chain(pts, false), {
            friction: 0.5,
            restitution: 0.2,
        });
    }

    _createFullBoundary() {
        // Replace bowl with full circle
        let f = this._boundary.getFixtureList();
        while (f) {
            const next = f.getNext();
            this._boundary.destroyFixture(f);
            f = next;
        }
        const pts = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            pts.push(Vec2(Math.cos(a) * WORLD_RADIUS, Math.sin(a) * WORLD_RADIUS));
        }
        this._boundary.createFixture(Chain(pts, true), {
            friction: 0.5,
            restitution: 0.2,
        });
    }

    toggle(mode = 'analog') {
        if (this.active) this.close();
        else if (!this._closing) this.open(mode);
    }

    setOrientation(degrees) {
        this._orientation = degrees;
        this._updateGravity();
    }

    _updateGravity() {
        if (!this._world) return;
        // Same gravity formula as the analog clock's gravity world —
        // both live inside the CSS-rotated #clock element.
        const rad = this._orientation * DEG;
        this._world.setGravity(Vec2(
            -GRAVITY * Math.sin(rad),
            -GRAVITY * Math.cos(rad)
        ));

        // Wake all bodies so they respond to the new gravity direction
        for (const body of this._bodies) {
            body.setAwake(true);
        }
        if (this._closeBody) {
            this._closeBody.setAwake(true);
        }
    }

    _animate() {
        if (!this.active && !this._closing) return;

        const now = performance.now();
        let dt = (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (dt > MAX_STEPS_PER_FRAME * TIME_STEP) {
            dt = MAX_STEPS_PER_FRAME * TIME_STEP;
        }

        // Close button expand animation
        if (this._closing && this._closeExpandStart) {
            const elapsed = performance.now() - this._closeExpandStart;
            const BUBBLE_SIZE = CLOSE_RADIUS * 4;

            // Pop style: after first jiggle, destroy bubble and drop everything
            if (this._closeStyle === 'pop' && elapsed >= 600 && !this._popped) {
                this._popped = true;
                if (this._closeBody && this._world) {
                    this._world.destroyBody(this._closeBody);
                    this._closeBody = null;
                }
                if (this._boundary && this._world) {
                    this._world.destroyBody(this._boundary);
                    this._boundary = null;
                }
                // Restore gravity so everything drops
                this._updateGravity();
                for (const body of this._bodies) {
                    body.setAwake(true);
                }
            }

            // Both styles: grow the close button during phases 1-2
            // Expand style continues with phases 3-5
            if (this._closeBody) {
                const BUBBLE_SIZE_2 = CLOSE_RADIUS * 5.5;

                let newRadius;
                if (elapsed < 200) {
                    const t = elapsed / 200;
                    const overshoot = Math.sin(t * Math.PI) * 0.3;
                    const eased = t * t * (3 - 2 * t);
                    newRadius = CLOSE_RADIUS + (BUBBLE_SIZE - CLOSE_RADIUS) * (eased + overshoot);
                } else if (elapsed < 600) {
                    const jt = (elapsed - 200) / 400;
                    const jiggle = Math.sin(jt * Math.PI * 6) * CLOSE_RADIUS * 0.15 * (1 - jt);
                    newRadius = BUBBLE_SIZE + jiggle;
                } else if (elapsed < 800) {
                    const t = (elapsed - 600) / 200;
                    const eased = t * t * (3 - 2 * t);
                    newRadius = BUBBLE_SIZE + (BUBBLE_SIZE_2 - BUBBLE_SIZE) * eased;
                } else if (elapsed < 1200) {
                    const jt = (elapsed - 800) / 400;
                    const jiggle = Math.sin(jt * Math.PI * 6) * CLOSE_RADIUS * 0.12 * (1 - jt);
                    newRadius = BUBBLE_SIZE_2 + jiggle;
                } else {
                    if (!this._boundaryRemoved) {
                        this._boundaryRemoved = true;
                        if (this._boundary && this._world) {
                            this._world.destroyBody(this._boundary);
                            this._boundary = null;
                        }
                    }
                    const t = Math.min((elapsed - 1200) / 1200, 1);
                    const eased = t * t * (3 - 2 * t);
                    newRadius = BUBBLE_SIZE_2 + (WORLD_RADIUS * 2.5 - BUBBLE_SIZE_2) * eased;
                }

                if (newRadius !== this._closeRadius) {
                    this._closeRadius = newRadius;
                    const fixture = this._closeBody.getFixtureList();
                    if (fixture) this._closeBody.destroyFixture(fixture);
                    const bouncy = elapsed < 1200;
                    this._closeBody.createFixture(Circle(newRadius), {
                        density: bouncy ? 8.0 : 0.1,
                        friction: 0.1,
                        restitution: bouncy ? 1.2 : 0.0,
                    });

                    if (this._closeContactDir) {
                        const d = this._closeContactDir;
                        const center = Vec2(d.x * (WORLD_RADIUS - newRadius), d.y * (WORLD_RADIUS - newRadius));
                        this._closeBody.setTransform(center, this._closeBody.getAngle());

                        const growth = newRadius - (this._prevCloseRadius || CLOSE_RADIUS);
                        if (growth > 0) {
                            for (const body of this._bodies) {
                                const pos = body.getPosition();
                                const dx = pos.x - center.x;
                                const dy = pos.y - center.y;
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                const overlap = newRadius - dist;
                                if (overlap > 0 && dist > 0.01) {
                                    const nx = dx / dist;
                                    const ny = dy / dist;
                                    const force = overlap * 500;
                                    body.applyLinearImpulse(
                                        Vec2(nx * force, ny * force),
                                        body.getWorldCenter(),
                                        true
                                    );
                                }
                            }
                        }
                        this._prevCloseRadius = newRadius;
                    }
                }
            }
        }

        this._accumulator += dt;
        while (this._accumulator >= TIME_STEP) {
            this._world.step(TIME_STEP);
            this._accumulator -= TIME_STEP;
        }

        // Create boundary once all bodies are well inside the circle
        if (!this._boundaryReady && !this._closing) {
            const safeRadius = WORLD_RADIUS - BUTTON_WIDTH / 2;
            const r2 = safeRadius * safeRadius;
            const allInside = this._bodies.every(b => {
                const p = b.getPosition();
                return p.x * p.x + p.y * p.y < r2;
            }) && (!this._closeBody || (() => {
                const p = this._closeBody.getPosition();
                return p.x * p.x + p.y * p.y < r2;
            })());

            if (allInside) {
                this._boundaryReady = true;
                this._createFullBoundary();
            }
        }

        this._render();
        this._animFrame = requestAnimationFrame(() => this._animate());
    }

    _render() {
        const clockSize = this.clockElement.clientWidth;
        const scale = clockSize / (WORLD_RADIUS * 2);
        const center = clockSize / 2;

        // Convert physics position to DOM position, same as detached hands:
        // rotate by orientation, then flip Y for CSS
        const rad = this._orientation * DEG;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const toDOM = (pos) => {
            const rx = pos.x * cos - pos.y * sin;
            const ry = pos.x * sin + pos.y * cos;
            return { x: center + rx * scale, y: center - ry * scale };
        };

        for (let i = 0; i < this._bodies.length; i++) {
            const body = this._bodies[i];
            const el = this._elements[i];
            const pos = body.getPosition();
            const bodyDeg = -body.getAngle() / DEG;
            const renderDeg = bodyDeg - this._orientation;
            const dom = toDOM(pos);
            const w = BUTTON_WIDTH * scale;
            const h = BUTTON_HEIGHT * scale;

            el.style.width = `${w}px`;
            el.style.height = `${h}px`;
            el.style.fontSize = `${h * 0.55}px`;
            el.style.transform = `translate(${(dom.x - w / 2).toFixed(1)}px, ${(dom.y - h / 2).toFixed(1)}px) rotate(${renderDeg.toFixed(1)}deg)`;
        }

        // Close button — bg scales with physics radius, icon stays fixed
        if (this._closeBody && this._closeElement) {
            const pos = this._closeBody.getPosition();
            const bodyDeg = -this._closeBody.getAngle() / DEG;
            const renderDeg = bodyDeg - this._orientation;
            const dom = toDOM(pos);
            const r = this._closeRadius || CLOSE_RADIUS;
            const d = r * 2 * scale;
            const iconD = CLOSE_RADIUS * 2 * scale;

            this._closeElement.style.width = `${d}px`;
            this._closeElement.style.height = `${d}px`;
            this._closeElement.style.transform = `translate(${(dom.x - d / 2).toFixed(1)}px, ${(dom.y - d / 2).toFixed(1)}px) rotate(${renderDeg.toFixed(1)}deg)`;

            if (this._closeIcon) {
                this._closeIcon.style.fontSize = `${iconD * 0.45}px`;
            }
        }
    }
}
