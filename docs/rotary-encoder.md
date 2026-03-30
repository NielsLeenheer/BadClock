# Rotary Encoder Setup

How to connect a HW-040 rotary encoder to the Pi 4B with a Sense HAT already installed.

## GPIO availability

The Sense HAT uses very few GPIO pins directly:
- **GPIO 2 & 3** — I2C bus (all sensors)
- **GPIO 27 & 28** — HAT ID EEPROM (reserved)

The joystick is read via an onboard Atmel microcontroller over I2C, so it does **not** occupy any GPIO pins. Everything else is free.

## Physical wiring

The HW-040 has built-in pull-up resistors, so no external components are needed.

| HW-040 Pin | Pi Pin | GPIO |
|------------|--------|------|
| GND        | Any GND pin | — |
| +  (VCC)   | 3.3V   | — |
| CLK        | Pin 29 | GPIO 5 |
| DT         | Pin 31 | GPIO 6 |
| SW (button)| Pin 33 | GPIO 13 |

Any free GPIO works — 5, 6, 13 are just convenient choices that are physically adjacent.

**Note:** If the Sense HAT is seated directly on the header, you'll need a stacking header (extended 40-pin) to access the GPIO pins underneath.

## Reading the encoder

### Option A: Device tree overlay (recommended)

The most reliable approach — the kernel handles the encoder at interrupt level.

Add to `/boot/config.txt`:

```
dtoverlay=rotary-encoder,pin_a=5,pin_b=6,relative_axis=1
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

For the push button on GPIO 13, add a second overlay:

```
dtoverlay=gpio-key,gpio=13,keycode=28,label="encoder-button"
```

### Option B: Python GPIO directly

Using `RPi.GPIO` with edge detection:

```python
import RPi.GPIO as GPIO

CLK = 5
DT = 6

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

## Server changes

The encoder would need to be integrated into `server.py` as a new data source alongside the Sense HAT orientation data.

Add a new SSE stream or extend the existing `/orientation/stream` with encoder events:

```python
# New endpoint for winding data
@app.route('/winding/stream')
def winding_stream():
    def generate():
        dev = InputDevice('/dev/input/event0')
        for event in dev.read_loop():
            if event.type == ecodes.EV_REL:
                yield f"data: {json.dumps({'delta': event.value})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )
```

The clock UI would connect to this stream and accumulate winding energy. The delta values (+1/-1 per detent) would map to winding amount.

A push of the encoder button could also be exposed — useful as a mode switch or reset.
