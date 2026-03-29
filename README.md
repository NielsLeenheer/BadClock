# BadClock

An auto-rotating clock for Raspberry Pi with a circular display. The clock uses the Sense HAT's accelerometer to detect device orientation and rotates the clock face so it always reads correctly, no matter how the Pi is mounted or turned.

The clock has two display modes — digital (default) and analog — that you can swipe between.

## Hardware

- Raspberry Pi 4B
- Waveshare circular display
- Raspberry Pi Sense HAT (accelerometer + gyroscope + magnetometer)

## Clock modes

### Digital mode (default)

A red 7-segment display showing the time as HH:MM, with blinking colon dots. Tap individual segments to toggle them on or off and set the time. Each digit has its own 2-second edit timeout — if the segments form a valid number in context (e.g. hours 0-23, minutes 0-59) the time is adjusted; otherwise the digit flickers and turns off.

### Analog mode

A traditional analog clock with hour, minute, and second hands. Drag the hands to set the time. Shake the device to drop the hands into gravity mode, where they swing freely and hang downward.

### Switching modes

Swipe from the left or right edge of the screen to slide between digital (left) and analog (right). The swipe detection is rotation-aware, so the edges stay consistent regardless of how the device is oriented.

## How it works

The clock UI is built as a modular JavaScript application, bundled with Vite into a single standalone HTML file.

**Server** ([public/server.py](public/server.py)) - A Flask server that reads orientation data from the Sense HAT at ~30Hz. It uses the IMU's sensor fusion (accelerometer + gyroscope + magnetometer) for stable readings, applies exponential smoothing to the display angle, and exposes the data via a REST endpoint (`/orientation`) and a Server-Sent Events stream (`/orientation/stream`). On machines without a Sense HAT, it runs in simulation mode.

**Clock UI** ([src/](src/)) - The frontend, split into modules:

| Module | Description |
|---|---|
| [main.js](src/main.js) | Entry point — creates Clock, wires orientation source, swipe, and debug panel |
| [clock.js](src/clock.js) | Facade — owns clock faces, mode switching, rotation, and shake detection |
| [clock/analog.js](src/clock/analog.js) | Analog face — three hands with drag, inertia, and gravity physics |
| [clock/digital.js](src/clock/digital.js) | Digital face — 7-segment display with tap-to-edit |
| [clock/hand.js](src/clock/hand.js) | Single clock hand — touch interaction, gravity mode |
| [clock/mode-switcher.js](src/clock/mode-switcher.js) | Slide transitions between any number of modes |
| [clock/swipe-switch.js](src/clock/swipe-switch.js) | Rotation-aware edge-swipe detection |
| [orientation.js](src/orientation.js) | Sensor data — SSE from Pi + Generic Sensor API fallback |
| [shake-detector.js](src/shake-detector.js) | Shake gesture detection from Z-axis acceleration |
| [rotation-controller.js](src/rotation-controller.js) | Display rotation with dead zone and snap-to-90° |
| [debug-panel.js](src/debug-panel.js) | Debug toggle, manual controls, sensor error display |

**Diagnostics** ([public/diagnostics.py](public/diagnostics.py)) - A standalone I2C diagnostic tool that scans the bus for sensors and tests accelerometer readings.

## Building

The frontend is built with [Vite](https://vite.dev/) using [vite-plugin-singlefile](https://github.com/nicely-gg/vite-plugin-singlefile) to produce a single self-contained HTML file.

```bash
npm install
npm run build
```

This outputs `dist/` containing the built `index.html` plus the server-side files (`server.py`, `setup.sh`, `requirements.txt`, `diagnostics.py`) copied from `public/`.

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
2. Install system dependencies (`python3-flask`, `python3-flask-cors`, `sense-hat`, `i2c-tools`)
3. Install Python packages from `requirements.txt`
4. Test the I2C connection
5. Create and start a `clock-server` systemd service
6. Print instructions for configuring PiOSK to show the clock at boot

A reboot may be required if I2C wasn't previously enabled.

### Display with PiOSK

Configure [PiOSK](https://github.com/nicely-gg/piosk) to open `http://localhost:5000` in kiosk mode for a dedicated clock display.

## API

| Endpoint | Description |
|---|---|
| `GET /` | Serves the clock UI |
| `GET /orientation` | Current orientation as JSON (`x`, `y`, `z`, `display_angle`) |
| `GET /orientation/stream` | SSE stream of orientation updates |
| `GET /health` | Health check with sensor status and config |

## Diagnostics

To troubleshoot sensor issues on the Pi:

```bash
python3 diagnostics.py
```

This scans the I2C bus and tests each detected accelerometer.
