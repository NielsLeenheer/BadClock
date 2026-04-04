# BadClock

An auto-rotating clock for Raspberry Pi with a circular display. The clock uses an accelerometer to detect device orientation and rotates the clock face so it always reads correctly, no matter how the Pi is mounted or turned.

The clock has two display modes — digital (default) and analog — that you can swipe between. Both modes misbehave in their own ways.

## Hardware

- Raspberry Pi 4B
- Waveshare circular display
- Adafruit LSM303DLHC accelerometer (on Perma-Proto HAT) or Raspberry Pi Sense HAT
- Rotary encoder (KY-040 or Grove) for winding — GPIO 13 (CLK), 12 (DT), 6 (SW)
- Battery HAT (optional, for portable use)

## Clock modes

### Digital mode (default)

A red 7-segment display showing the time as HH:MM, with blinking colon dots. Individual segments decay in brightness over time. Segments occasionally flicker (slow pulsing or fast erratic) and can break entirely — broken segments stay dark until the digit changes.

### Analog mode

A traditional analog clock with hour, minute, and second hands driven by a planck.js physics simulation. Drag the hands to set the time — they coast with inertia on release. Shake the device to drop the hands into gravity mode, where they swing from the center pivot and fall under real gravity.

Flick a hand hard enough and it detaches completely — bouncing around inside the clock face until it settles back at the pivot. There's also a 1-in-50 chance a hand detaches just from picking it up.

A crown (revealed by swiping left from analog mode) lets you wind the clock. Swipe down to wind up, swipe up to unwind. A physical rotary encoder (KY-040 or Grove) can also wind the clock — each detent adds 1% energy. Energy decays over 48 hours — when it runs low, the clock drifts backward. Overwind it and all the hands fly off.

### Switching modes

Swipe from the left or right edge of the screen to slide between digital (left), analog (middle), and crown (right). The swipe detection is rotation-aware, so the edges stay consistent regardless of how the device is oriented.

## How it works

The clock UI is built as a modular JavaScript application, bundled with Vite into a single standalone HTML file. The analog clock uses [planck.js](https://piqnt.com/planck.js/) for physics — two separate worlds (one for normal timekeeping, one for gravity mode) with hands switching between them. See [physics-architecture.md](docs/physics-architecture.md) for the full design.

**Server** ([public/server.py](public/server.py)) - A Flask server that reads orientation data from the accelerometer at ~30Hz. It auto-detects the sensor (LSM303DLHC at 0x19 or Sense HAT), applies exponential smoothing to the display angle, detects shake gestures server-side, and exposes the data via a Server-Sent Events stream (`/orientation/stream`). The stream sends `{ display_angle }` with an optional `shake: true` flag — no raw accel data goes over the wire. It also reads rotary encoder events via `/winding/stream`. On machines without a sensor, it runs in simulation mode. When no SSE server is available, the client falls back to the browser's Generic Sensor API.

**Diagnostics** ([public/diagnostics.py](public/diagnostics.py)) - A standalone I2C diagnostic tool that scans the bus for sensors and tests accelerometer readings.

## Building

The frontend is built with [Vite](https://vite.dev/) using [vite-plugin-singlefile](https://github.com/nicely-gg/vite-plugin-singlefile) to produce a single self-contained HTML file.

```bash
npm install
npm run build
```

This outputs `dist/` containing the built `index.html` plus the server-side files (`server.py`, `setup.sh`, `requirements.txt`, `diagnostics.py`, `encoder-test.py`) and font files copied from `public/`.

For development with hot reload:

```bash
npm run dev
```

## Deploying to the Pi

Copy the `dist/` directory to the Pi:

```bash
scp -r dist/* admin@<pi-ip>:~/clock/
```

Then run the setup script on the Pi:

```bash
ssh admin@<pi-ip>
cd ~/clock
bash setup.sh
```

The setup script will:
1. Enable I2C on the Pi
2. Install system dependencies (`python3-flask`, `python3-flask-cors`, `python3-smbus`, `python3-evdev`, `sense-hat`, `i2c-tools`)
3. Install Python packages from `requirements.txt`
4. Test the I2C connection
5. Configure rotary encoder device tree overlay
6. Create and start a `clock-server` systemd service
7. Print instructions for configuring PiOSK to show the clock at boot

A reboot may be required if I2C wasn't previously enabled.

### Display with PiOSK

Configure [PiOSK](https://github.com/nicely-gg/piosk) to open `http://localhost:5000` in kiosk mode for a dedicated clock display.

## Quirks & debug console

The clock is globally available as `window.clock` in the browser console. All debug commands are under `clock.debug`. Run `clock.debug.help()` for a quick reference.

### Analog quirks

| Quirk | What happens | Natural trigger | Console command |
|---|---|---|---|
| **Random detach** | Hand detaches when you pick it up | 1-in-50 chance on drag | `clock.debug.setForceDetachOnDrag(true)` |
| **Flick detach** | Hand flies off when released at high speed | Flick a hand >1500°/s | `clock.debug.spin(2, 30)` |
| **Shake / gravity mode** | All hands drop under real gravity | Shake the device | `clock.debug.shake()` |
| **Coasting** | Released hand spins freely before settling | Drag and release a hand | Drag manually |
| **Auto-reattach** | Detached hands snap back when near center | Hand drifts back slowly | Wait after shake mode |
| **Crown energy decay** | Clock drifts backward when unwound | Energy depletes over 48h | `clock.debug.energy(0.1)` |
| **Overwind** | All hands launch off the clock | Wind crown past 120% | `clock.debug.overwind()` |
| **DST confusion** | Clock randomly handles DST wrong | System timezone changes | `clock.debug.dst()` |

### Digital quirks

| Quirk | What happens | Natural trigger | Console command |
|---|---|---|---|
| **Segment decay** | Lit segments dim from 100% to 50% over 2h | Automatic over time | `clock.debug.decay(60)` |
| **Segment flicker** | Segment blinks erratically (slow or fast) | Random ~1-in-1M per frame | `clock.debug.flicker()` |
| **Segment burnout** | Flickering segment goes permanently dark | Random while flickering | Wait after flicker |
| **Flicker self-heal** | Flickering segment recovers on its own | Random ~1-in-10K per frame | Wait (~2.5 min avg) |
| **Segment editing** | Tap segments to toggle them on/off | Tap on digital display | Tap directly |
| **Invalid time error** | Edited digit blinks and clears | Set an impossible time | Tap invalid segments |

### DST behaviors

When a DST transition is detected (1/3 chance each):

| Behavior | Effect | Console |
|---|---|---|
| **Correct** | Does nothing — lucky! | `clock.debug.dst(-60)` (spring fwd) |
| **Forgot** | Cancels the DST shift, stays at old time | `clock.debug.dst(60)` (fall back) |
| **Reversed** | Shifts double the wrong direction | Roll is random each time |

### Debug commands reference

```
clock.debug.help()              — Show all commands
clock.debug.detachAll()         — Detach all analog hands
clock.debug.detach(i)           — Detach hand (0=hour, 1=min, 2=sec)
clock.debug.spin(i, speed)      — Spin a hand (may detach if fast)
clock.debug.overwind()          — Over-wind → all hands fly off
clock.debug.energy(0..1)        — Set crown winding energy
clock.debug.crown(bool)         — Show/hide the crown
clock.debug.flicker()           — Random digital segment flicker
clock.debug.decay(minutes)      — Age digital segments
clock.debug.shake()             — Enter gravity mode
clock.debug.dst(offset)         — Simulate DST (-60=spring fwd, 60=fall back)
clock.debug.setForceDetachOnDrag(bool) — Force 100% detach on drag
```

## API

| Endpoint | Description |
|---|---|
| `GET /` | Serves the clock UI |
| `GET /font/<file>` | Serves font files |
| `GET /orientation` | Current orientation as JSON (`display_angle`, `shake`) |
| `GET /orientation/stream` | SSE stream — `{ display_angle }` with optional `shake: true` |
| `GET /winding/stream` | SSE stream — `{ delta: +1/-1 }` per encoder detent |
| `GET /health` | Health check with sensor type, encoder status, and config |

## Diagnostics

To troubleshoot sensor issues on the Pi:

```bash
python3 diagnostics.py
```

This scans the I2C bus and tests each detected accelerometer. For live axis calibration of the LSM303DLHC:

```bash
python3 diagnostics.py live
```

To test the rotary encoder independently:

```bash
python3 encoder-test.py
```

See [docs/rotary-encoder.md](docs/rotary-encoder.md) for wiring and setup details.
