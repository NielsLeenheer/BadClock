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

The project has three main parts:

**[server.py](server.py)** - A Flask server that reads orientation data from the Sense HAT at ~30Hz. It uses the IMU's sensor fusion (accelerometer + gyroscope + magnetometer) for stable readings, applies exponential smoothing to the display angle, and exposes the data via a REST endpoint (`/orientation`) and a Server-Sent Events stream (`/orientation/stream`). On machines without a Sense HAT, it runs in simulation mode with a slowly rotating angle.

**[clock.html](clock.html)** - The clock UI rendered in HTML/CSS/JS, served by the Flask app. It connects to the orientation stream and counter-rotates the clock face to compensate for physical rotation. Rotation uses a dead zone (8°) to avoid jitter from screen touches, and snaps to the nearest 90° angle after 800ms of stillness. On the Pi (localhost), it runs full-screen with a minimal look; elsewhere, it shows a visible clock face.

**[diagnostics.py](diagnostics.py)** - A standalone I2C diagnostic tool that scans the bus for sensors and tests accelerometer readings. Useful for debugging hardware issues.

## Installation

### Quick setup

Clone the repo onto your Pi and run the setup script:

```bash
git clone <repo-url> ~/clock
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

### Manual setup

```bash
sudo apt-get install -y python3-pip i2c-tools python3-flask python3-flask-cors sense-hat
pip3 install -r requirements.txt
```

## Running

### Manually

```bash
python3 server.py
```

The clock will be available at `http://localhost:5000`.

### As a service

If you used `setup.sh`, the clock runs automatically on boot via systemd:

```bash
sudo systemctl status clock-server   # check status
sudo journalctl -u clock-server -f   # view logs
sudo systemctl restart clock-server  # restart
sudo systemctl stop clock-server     # stop
```

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

To troubleshoot sensor issues:

```bash
python3 diagnostics.py
```

This scans the I2C bus and tests each detected accelerometer.
