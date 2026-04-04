# Rotary Encoder Setup

How to connect a rotary encoder to the Pi 4B for the crown winding mechanism. Supports both the KY-040 (5-pin) and Grove rotary encoder (4-pin via JST connector).

## GPIO availability

The Sense HAT / Perma-Proto HAT use:
- **GPIO 2 & 3** — I2C bus (accelerometer + sensors)

Everything else is free.

## Physical wiring

The KY-040 has built-in pull-up resistors, so no external components are needed.

| Signal     | Pi Pin | GPIO    | KY-040 Pin | Grove Wire |
|------------|--------|---------|------------|------------|
| CLK (A)    | Pin 33 | GPIO 13 | CLK        | SIG A (Yellow) |
| DT (B)     | Pin 32 | GPIO 12 | DT         | SIG B (White) |
| SW (button)| Pin 31 | GPIO 6  | SW         | — (not wired) |
| VCC        | 3.3V   | —       | +          | Red |
| GND        | Any GND| —       | GND        | Black |

The Grove encoder's push button is on the PCB but not routed through the JST connector — only CLK/DT/VCC/GND are wired.

## Reading the encoder

### Option A: Device tree overlay (recommended)

The most reliable approach — the kernel handles the encoder at interrupt level.

Add to boot config:
- **Pi OS Bookworm/Trixie:** `/boot/firmware/config.txt`
- **Older Pi OS:** `/boot/config.txt`

```
dtoverlay=rotary-encoder,pin_a=13,pin_b=12,relative_axis=1
```

Reboot. The encoder appears as an input device at `/dev/input/eventX`. Read it in Python with the `evdev` library:

```python
from evdev import InputDevice, categorize, ecodes

dev = InputDevice('/dev/input/event0')  # check actual device path
for event in dev.read_loop():
    if event.type == ecodes.EV_REL:
        # event.value is +1 (clockwise) or -1 (counter-clockwise)
        print(f'Turn: {event.value}')
```

For the push button on GPIO 6, add a second overlay:

```
dtoverlay=gpio-key,gpio=6,keycode=28,label="encoder-button"
```

### Option B: Python GPIO directly

Using `RPi.GPIO` with edge detection:

```python
import RPi.GPIO as GPIO

CLK = 13
DT = 12

GPIO.setmode(GPIO.BCM)
GPIO.setup(CLK, GPIO.IN)
GPIO.setup(DT, GPIO.IN)

def on_rotate(channel):
    if GPIO.input(DT):
        print('Counter-clockwise')
    else:
        print('Clockwise')

GPIO.add_event_detect(CLK, GPIO.FALLING, callback=on_rotate, bouncetime=2)
```

The device tree approach is more reliable at high rotation speeds since it runs in kernel space.

## Server integration

The encoder is fully integrated into `server.py`:

- **`EncoderReader`** class auto-detects the encoder by scanning `/dev/input/event*` for devices with "rotary" in the name
- **`/winding/stream`** SSE endpoint sends `{ delta: +1 }` or `{ delta: -1 }` per detent
- The client (`winding-source.js`) connects to this stream and calls `clock.windCrown()` with 0.01 energy per tick (1% — about 5 full rotations to fully wind)

## Diagnostics

Test the encoder hardware independently:

```bash
python3 encoder-test.py
```

This scans for the encoder device, then prints live events as you rotate.
