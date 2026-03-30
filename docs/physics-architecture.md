# Analog Clock Physics Architecture

## Spaces

There are three spaces:

- **Physical space** — the real world. The device can be rotated. Gravity always points to the floor.
- **Screen space** — the pixels on the display. When the device rotates, screen space rotates with it.
- **Model space** — the planck.js simulation. Coordinates are abstract and mapped to screen pixels at render time.

## Two models

The simulation uses two separate planck.js worlds:

### Time model

- Contains the clock mechanism: anchor, hand bodies, revolute joints with motors.
- Motors drive hands to target time angles.
- Gravity is zero in this world AND hands have gravityScale 0 (belt and suspenders).
- The anchor is kinematic and does NOT rotate. It stays fixed at angle 0.
- This model operates in physical space. `#analog` is inside `#clock` which is CSS-rotated by device orientation, so DOM transforms are already in physical space — no orientation correction needed for rendering.
- Hands normally have a revolute joint to the anchor with a motor. The joint is destroyed during dragging and coasting, and recreated when the hand settles.

### Gravity model

- Contains free-floating hand bodies, a static pivot for swinging hands, and a circular boundary for bouncing.
- Gravity is active and rotates with device orientation to always point toward physical down.
- This model operates in screen space. Gravity direction changes when the device orientation changes.
- Hands in this model are either jointed to the pivot (swinging) or completely free (detached/thrown).

## Collision categories

Hands use collision filter categories to control interactions:

- **CAT_ATTACHED** (0x0001) — hands jointed to the anchor or pivot. They collide only with the boundary, and have groupIndex -1 so they never collide with each other.
- **CAT_DETACHED** (0x0002) — free-floating hands. They collide with the boundary AND with other detached hands (groupIndex 0).
- **CAT_BOUNDARY** (0x0004) — the circular wall in the gravity model. Collides with everything.

When a hand detaches, its filter is updated from CAT_ATTACHED to CAT_DETACHED so it can bounce off the boundary and other detached hands.

## Converting between models

When a hand moves from one model to the other, we convert:

- **Position** — rotate (x, y) by the orientation angle
- **Angle** — add or subtract the orientation offset (in radians)
- **Linear velocity** — rotate (vx, vy) by the orientation angle
- **Angular velocity** — unchanged (scalar, frame-independent)

The conversion is a 2D rotation by the current device orientation. Physical→screen rotates by `+orientation`; screen→physical rotates by `-orientation`.

Body lifecycle ordering: the old body is destroyed FIRST, then the new body is created. State is captured before destruction.

## Hand ownership

Each hand has:
- One DOM element (permanent, inside `#analog-face`)
- A body in the time model OR a body in the gravity model — never both
- A mode that determines which model owns it: `clock` and `coasting` → time model, `gravity` and `detached` → gravity model

When switching between models:
1. Read state from the current body: position, angle, linear velocity, angular velocity
2. Destroy the old body in the source model
3. Convert state between spaces (rotate by orientation)
4. Create a new body in the target model with the converted state
5. Create appropriate joints (revolute to anchor for clock, revolute to pivot for gravity, none for detached/coasting)

Bodies are destroyed and recreated — not reused or deactivated. This keeps each model clean with no leftover state or accidental collisions.

Note: when switching to time model, velocity is NOT preserved. The body is placed at the converted angle with zero velocity. The motor drives it to speed.

## Transitions

### User shakes the clock: time → gravity

Only hands currently in the time model switch. Hands already in the gravity model (e.g. a previously detached hand) are unaffected. For each time-model hand:
1. Read position, angle, velocity from the time model body
2. Convert from physical space to screen space
3. Create body in the gravity model at the converted position
4. Attach to the pivot via revolute joint (no motor)
5. Hands fall under gravity

Each hand gets an `onDragInGravityMode` callback so the system knows when it returns.

### User picks up a hand: drag behavior depends on mode

On drag start:
- The joint (if any) is destroyed
- Angular and linear velocity are zeroed
- Gravity scale is set to 0
- The hand tracks touch input directly

**Random detach (1-in-50 chance):** When picking up a hand from the time model, there is a 1-in-50 random chance the hand detaches on contact — it switches to the gravity model as a detached body. The drag continues in the gravity model with position tracking instead of angle tracking. A debug checkbox can force this to 100%.

**Detached hand drag:** The hand tracks position (not angle) with an offset from where it was grabbed. Linear velocity is tracked for throw-on-release.

**All other drags:** The hand tracks angle in model space (screen angle minus orientation for time model, screen angle direct for gravity model). Angular velocity is tracked for release behavior.

### Release behavior depends on what was being dragged

**Release from detached drag:** The hand stays detached. Gravity is re-enabled. If released quickly, the tracked linear velocity is applied (scaled to 30%) for a throw effect.

**Release from gravity (swinging) drag:** The hand switches from the gravity model to the time model. If released with angular velocity > 80 deg/s, it enters coasting mode (see below). The `onDragInGravityMode` callback fires, which updates the shake-mode CSS class.

**Flick detach (release velocity > 1500 deg/s):** The hand detaches from the time model into the gravity model. The tip velocity is computed from angular velocity and hand length, converted to screen space, and applied as linear velocity. Only applies to time-model hands (not gravity or already detached).

**Normal release in time model:** The hand enters coasting mode.

### Coasting (time model, no joint)

Coasting keeps the hand in the time model but without a joint. The hand spins freely:
1. Joint stays destroyed (or is destroyed if it existed)
2. Mode is set to `coasting`, angular velocity from the release is applied
3. Each frame: position is pinned to (0,0), linear velocity zeroed (only angular matters)
4. Angular damping (0.8) slows the hand naturally
5. When angular velocity drops below 0.05 rad/s, coasting ends:
   - Save current angle, reset body to angle 0
   - Create anchor joint (referenceAngle = 0)
   - Restore the saved angle
   - Set mode to `clock`, mark `manuallySet = true`

The trick of resetting to 0 before creating the joint ensures `referenceAngle = 0`, so `joint.getJointAngle()` equals the body's actual angle.

### Auto-reattachment: detached → time

Each frame, detached hands (not being dragged) are checked for reattachment. A hand reattaches when ALL of:
- The hand's base (pivot end) is within 0.4 world units of the origin
- The base is closer to the origin than the tip (hand is roughly pointing outward)
- Linear speed < 0.5 AND angular speed < 0.5

When conditions are met, the hand switches to the time model with a motor joint.

### Clock is over-wound: per-mode behavior with stagger

The crown's `onOverwind` callback handles each hand based on its current mode:

- **Time-model hands (clock/coasting):** Detached with staggered timing (10-50ms between each). Each gets random linear velocity (±10) and angular velocity (±10).
- **Gravity-model hands (swinging):** Detached from pivot with a small upward push to clear the reattach zone.
- **Already detached:** No change.

## Crown and drift

The crown tracks winding energy (0 to OVERWIND_THRESHOLD = 1.2). Energy decays over 48 hours. Each frame, `crown.update()` returns a wind factor:

- Energy > 0.3 → factor = 1.0 (no drift)
- Energy 0–0.3 → factor = energy / 0.3 (proportional drift)
- Factor < 1.0 → drift rate = (1 - factor) × -2 ms/frame, accumulated and applied to time offset

The clock drifts backward when underwound. At energy = 0, drift is -2ms per frame.

Wind amount per crown swipe: +0.05 (swipe down) or -0.05 (swipe up), clamped at 0 minimum. Over-winding past 1.2 triggers the overwind callback and resets energy to 0.

## Manual time setting

When a hand is dragged (or coasts to a stop), it's flagged `manuallySet`. Each frame, the update loop checks:
- Are there any manually-set hands?
- Are all time-model hands settled (canCorrect: not dragging, mode=clock, angular velocity < 0.1)?
- Are ALL hands back in the time model?

When all conditions are met, the displayed time is derived from hand angles (hour from hand[0], minute from hand[1], second from hand[2]) and applied as a time offset. The `manuallySet` flags are then cleared.

## Rendering and input

No counter-counter-rotation on `#analog`. `#analog` is inside `#clock` which is CSS-rotated by the device orientation, so `#analog` and its DOM transforms are in physical space. Touch events are always in screen space.

|              | Model space | DOM space | Input (screen) | Rendering (physical) |
|--------------|-------------|-----------|----------------|----------------------|
| Time model   | physical    | physical  | needs conversion (screen → physical) | direct |
| Gravity model| screen      | physical  | direct         | needs conversion (screen → physical) |

### Angle convention

Planck.js uses counter-clockwise positive angles. CSS `rotate()` uses clockwise positive. All rendering negates the planck angle when converting to degrees:

```
clockDeg = -(angle / DEG)
```

This negation appears in BOTH time model and gravity model rendering.

### Time model rendering

Joint angle is negated and converted to degrees. No orientation correction needed (physical space matches DOM space):

```
CSS rotate = -(joint.getJointAngle() / DEG)
```

Input needs conversion — subtract orientation from screen-space angle to get physical-space angle:
```
modelAngle = screenAngle - orientation
```

### Gravity model rendering

Body angle is negated, converted to degrees, then orientation is subtracted to go from screen space to physical (DOM) space:

```
bodyDeg = -(body.getAngle() / DEG)
CSS rotate = bodyDeg - orientation          (for pivoted hands)
```

For detached hands, position must also be converted from screen-space to physical-space DOM coordinates. The position is rotated by `+orientation` (standard 2D rotation matrix), then Y is flipped for CSS (+Y down):

```
bodyDeg = -(body.getAngle() / DEG)
rad = orientation * DEG
rx = pos.x * cos(rad) - pos.y * sin(rad)
ry = pos.x * sin(rad) + pos.y * cos(rad)
px = rx * scale
py = -ry * scale                            (flip Y: planck up → CSS down)
CSS translate = (px, py)
CSS rotate = bodyDeg - orientation
```

Input is direct — touch events are in screen space, gravity model is in screen space.

## Orientation changes

When device orientation changes:

- **`#clock`** CSS rotates to keep the face upright.
- **`#analog`** is NOT counter-rotated. It stays in physical space (inside `#clock`).
- **Time model**: nothing changes. Anchor stays at 0. Motors keep running. No render correction needed — physical space matches DOM space.
- **Gravity model**: gravity vector rotates to point toward new physical down. Free hands respond naturally — if they were in equilibrium, the gravity change pulls them toward the new low point. All gravity-model bodies are woken.

## What changes each frame

| Property | When | Who |
|---|---|---|
| `#clock` CSS rotate | orientation changes | clock.js |
| Gravity vector (gravity model) | orientation changes | analog.js |
| Motor target angles (time model) | every frame | analog.js |
| Hand body angles (time model) | physics step | planck.js |
| Hand body positions (gravity model) | physics step | planck.js |
| Hand DOM transforms | every frame | hand.js render() |
| Crown energy (decay) | every frame | crown.js |
| Time drift (when unwound) | every frame | analog.js |
| Coasting checks | every frame | hand.js |
| Reattach checks | every frame | analog.js |

## What never changes

| Property | Value |
|---|---|
| Time model anchor angle | 0 |
| Gravity model pivot angle | 0 |
| Gravity magnitude | 15 |
| World radius | 5 |
| Boundary shape | circular, radius 5 |
| Physics timestep | 1/60 |
| Angular damping | 0.8 |
| Linear damping | 0.3 |
