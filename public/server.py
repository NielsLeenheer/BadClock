#!/usr/bin/env python3
"""
Orientation server for auto-rotating clock
Uses Sense HAT library with sensor fusion (accelerometer + gyroscope + magnetometer)
for stable orientation readings
"""

from flask import Flask, jsonify, send_file, Response, stream_with_context
from flask_cors import CORS
import time
import math
import threading
import json

try:
    import smbus
    HAS_SMBUS = True
except ImportError:
    HAS_SMBUS = False
    print("⚠ smbus not available - shake detection may not work optimally")

try:
    from evdev import InputDevice, ecodes
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False
    print("⚠ evdev not available - rotary encoder will not work")

app = Flask(__name__)
CORS(app)

# ============================================================
# SENSOR CONFIGURATION
# ============================================================
SMOOTHING_FACTOR = 0.15   # Exponential smoothing (0.0=no smoothing, 1.0=max smoothing)
UPDATE_RATE = 0.033       # Sensor update rate in seconds (~30Hz)
# ============================================================

class SensorReader:
    """
    Read orientation data from accelerometer.
    Auto-detects: LSM303DLHC (Adafruit) or Sense HAT.
    """

    def __init__(self):
        self.sense = None
        self.i2c_bus = None
        self.sensor_type = None  # 'lsm303dlhc' | 'sense_hat' | None
        self.orientation_data = {
            'display_angle': 0,
            'accel_x_raw': 0,
            'accel_y_raw': -1,
            'accel_x': 0,
            'accel_y': 1,
            'accel_z': 0
        }
        self.running = False
        self.smoothed_angle = 0
        self.shaking = False

        # Shake detection state
        self._shake_history = []  # list of { time, z }
        self._shake_window = 0.6  # seconds to look back
        self._shake_threshold = 0.15  # minimum z-change to count as reversal
        self._shake_reversals_needed = 2
        self._shake_cooldown = 0  # timestamp when shake was last triggered

        self.initialize()

    def initialize(self):
        """Auto-detect and initialize accelerometer"""
        # Try LSM303DLHC first (Adafruit breakout at 0x19)
        if self._init_lsm303dlhc():
            return True
        # Fall back to Sense HAT
        if self._init_sense_hat():
            return True

        print("⚠ No accelerometer found — running in simulation mode")
        return False

    def _init_lsm303dlhc(self):
        """Try to initialize LSM303DLHC on I2C"""
        if not HAS_SMBUS:
            return False

        try:
            bus = smbus.SMBus(1)
            # Probe accelerometer at 0x19
            bus.read_byte_data(0x19, 0x20)

            # CTRL_REG1_A: 50Hz, all axes enabled
            bus.write_byte_data(0x19, 0x20, 0x47)
            # CTRL_REG4_A: ±2g, high resolution
            bus.write_byte_data(0x19, 0x23, 0x08)

            self.i2c_bus = bus
            self.sensor_type = 'lsm303dlhc'

            print("✓ LSM303DLHC accelerometer initialized (0x19)")
            print("  Using: Direct I2C reads")
            print("  Calculating: Display rotation from gravity projection")
            print()
            return True
        except:
            return False

    def _init_sense_hat(self):
        """Try to initialize Sense HAT"""
        try:
            from sense_hat import SenseHat

            self.sense = SenseHat()
            self.i2c_bus = smbus.SMBus(1) if HAS_SMBUS else None
            self.sensor_type = 'sense_hat'

            self.sense.set_imu_config(True, True, True)

            print("✓ Sense HAT initialized")
            print("  Using: Accelerometer (smoothed with gyro/compass)")
            print("  Calculating: Display rotation from gravity projection")
            print()
            return True
        except ImportError:
            return False
        except Exception:
            return False

    def read_raw_accel_for_shake(self):
        """Read raw accelerometer — for shake detection"""
        if self.sensor_type == 'lsm303dlhc':
            return self._read_lsm303dlhc_accel()

        if self.sensor_type == 'sense_hat':
            try:
                self.sense.set_imu_config(False, False, True)
                accel = self.sense.get_accelerometer_raw()
                self.sense.set_imu_config(True, True, True)
                return {'x': accel['x'], 'y': accel['y'], 'z': accel['z']}
            except:
                pass

        return {'x': 0, 'y': -1, 'z': 0}

    def _read_lsm303dlhc_accel(self):
        """Read LSM303DLHC accelerometer via I2C"""
        try:
            bus = self.i2c_bus
            # Read 6 bytes starting at 0x28 (with auto-increment bit 0x80)
            data = bus.read_i2c_block_data(0x19, 0x28 | 0x80, 6)
            # 12-bit left-justified, ±2g scale
            raw_x = (data[1] << 8 | data[0])
            raw_y = (data[3] << 8 | data[2])
            raw_z = (data[5] << 8 | data[4])

            # Convert to signed
            if raw_x > 32767: raw_x -= 65536
            if raw_y > 32767: raw_y -= 65536
            if raw_z > 32767: raw_z -= 65536

            # Convert to g (12-bit left-justified in 16-bit, ±2g)
            x = raw_x / 16384.0
            y = raw_y / 16384.0
            z = raw_z / 16384.0

            return {'x': x, 'y': y, 'z': z}
        except:
            return {'x': 0, 'y': -1, 'z': 0}

    def read_orientation(self):
        """Read orientation and calculate display rotation from gravity"""
        if self.sensor_type == 'lsm303dlhc':
            accel = self._read_lsm303dlhc_accel()
            x = accel['x']
            y = accel['y']

            # LSM303DLHC axes are rotated 90° vs Sense HAT
            angle_rad = math.atan2(-y, x)
            angle_deg = math.degrees(angle_rad)
            if angle_deg < 0:
                angle_deg += 360

            return {
                'display_angle': angle_deg,
                'accel_x': x,
                'accel_y': y,
                'accel_z': accel['z']
            }

        if self.sensor_type == 'sense_hat':
            try:
                accel = self.sense.get_accelerometer_raw()
                x = accel['x']
                y = -accel['y']

                angle_rad = math.atan2(x, y)
                angle_deg = math.degrees(angle_rad)
                if angle_deg < 0:
                    angle_deg += 360

                return {
                    'display_angle': angle_deg,
                    'accel_x': x,
                    'accel_y': y,
                    'accel_z': accel['z']
                }
            except Exception as e:
                print(f"Error reading sensor: {e}")
                return {'display_angle': 0, 'accel_x': 0, 'accel_y': -1, 'accel_z': 0}

        # Simulation mode
        t = time.time()
        angle = (t * 30) % 360
        return {'display_angle': angle}
    
    def detect_shake(self, z):
        """Detect shake from Z-axis reversals"""
        now = time.time()

        # Add sample and trim old entries
        self._shake_history.append({'time': now, 'z': z})
        self._shake_history = [
            s for s in self._shake_history
            if now - s['time'] < self._shake_window
        ]

        if len(self._shake_history) <= 6:
            return False

        # Count direction reversals in Z
        reversals = 0
        prev_diff = 0

        for i in range(1, len(self._shake_history)):
            z_diff = self._shake_history[i]['z'] - self._shake_history[i - 1]['z']

            if i > 1 and prev_diff != 0 and z_diff != 0:
                if (abs(prev_diff) > self._shake_threshold and
                    abs(z_diff) > self._shake_threshold):
                    if (prev_diff > 0) != (z_diff > 0):
                        reversals += 1

            prev_diff = z_diff

        if reversals >= self._shake_reversals_needed and now - self._shake_cooldown > 1.0:
            self._shake_cooldown = now
            return True

        return False

    def apply_smoothing(self, new_angle):
        """Apply exponential smoothing with angle wraparound handling"""
        # Handle angle wraparound (359° → 1° is a small change, not 358°)
        diff = new_angle - self.smoothed_angle
        
        # Normalize difference to -180 to +180
        while diff > 180:
            diff -= 360
        while diff < -180:
            diff += 360
        
        # Apply exponential smoothing to the difference
        smoothed_diff = (1 - SMOOTHING_FACTOR) * diff
        self.smoothed_angle += smoothed_diff
        
        # Normalize result to 0-360
        while self.smoothed_angle >= 360:
            self.smoothed_angle -= 360
        while self.smoothed_angle < 0:
            self.smoothed_angle += 360
        
        return self.smoothed_angle
    
    def start_reading(self):
        """Start continuous sensor reading in background thread"""
        self.running = True
        
        def read_loop():
            while self.running:
                raw_data = self.read_orientation()

                # Apply smoothing to display angle only
                raw_angle = raw_data['display_angle']
                smoothed = self.apply_smoothing(raw_angle)

                # Get UNSMOOTHED accelerometer for shake detection
                shake_accel = self.read_raw_accel_for_shake()

                # Run shake detection on raw Z
                if self.detect_shake(shake_accel['z']):
                    self.shaking = True

                # Update stored data
                self.orientation_data = {
                    'display_angle': smoothed,
                    'raw_angle': raw_angle,
                }

                time.sleep(UPDATE_RATE)
        
        thread = threading.Thread(target=read_loop, daemon=True)
        thread.start()
        print("✓ Sensor reading thread started")
    
    def stop_reading(self):
        """Stop sensor reading"""
        self.running = False
    
    def get_data(self):
        """Get latest orientation data"""
        return self.orientation_data
    
    def get_display_angle(self):
        """Get the angle to rotate the display"""
        angle = self.orientation_data['display_angle']
        
        # Return smoothed angle directly (no snapping for smooth rotation)
        # Normalize to 0-360
        while angle >= 360:
            angle -= 360
        while angle < 0:
            angle += 360
        
        return angle


# Global sensor reader instance
sensor = SensorReader()
sensor.start_reading()


# ============================================================
# ROTARY ENCODER READER
# ============================================================

class EncoderReader:
    """
    Read rotary encoder events from HW-040 via device tree overlay.
    Uses evdev to read relative axis events from /dev/input/eventX
    """

    def __init__(self):
        self.device = None
        self.event_device = None
        self.running = False
        self.last_delta = 0

        self.initialize()

    def find_encoder_device(self):
        """Scan /dev/input/event* for rotary encoder"""
        if not HAS_EVDEV:
            return None

        import os
        for i in range(20):
            event_path = f'/dev/input/event{i}'
            if not os.path.exists(event_path):
                continue

            try:
                dev = InputDevice(event_path)
                if 'rotary' in dev.name.lower() or 'encoder' in dev.name.lower():
                    return event_path
            except:
                pass

        return None

    def initialize(self):
        """Initialize encoder device"""
        if not HAS_EVDEV:
            print("⚠ evdev library not available - encoder will not work")
            return False

        self.event_device = self.find_encoder_device()
        if not self.event_device:
            print("⚠ No rotary encoder device found")
            print("  Check device tree overlay in /boot/firmware/config.txt:")
            print("  dtoverlay=rotary-encoder,pin_a=13,pin_b=12,relative_axis=1")
            return False

        try:
            self.device = InputDevice(self.event_device)
            print(f"✓ Rotary encoder initialized on {self.event_device}")
            print(f"  Device: {self.device.name}")
            return True
        except Exception as e:
            print(f"⚠ Encoder initialization failed: {e}")
            return False

    def start_reading(self):
        """Start continuous encoder reading in background thread"""
        if self.device is None:
            return

        self.running = True

        def read_loop():
            try:
                for event in self.device.read_loop():
                    if event.type == ecodes.EV_REL:  # Relative axis event
                        # event.value is +1 (clockwise) or -1 (counter-clockwise)
                        self.last_delta = event.value
            except Exception as e:
                print(f"Encoder read error: {e}")
                self.running = False

        thread = threading.Thread(target=read_loop, daemon=True)
        thread.start()
        print("✓ Encoder reading thread started")

    def get_delta(self):
        """Get latest encoder delta and reset"""
        delta = self.last_delta
        self.last_delta = 0
        return delta


# Global encoder reader instance
encoder = EncoderReader()
encoder.start_reading()


@app.route('/')
def index():
    """Serve the clock HTML page"""
    return send_file('/home/admin/clock/index.html')


@app.route('/font/<path:filename>')
def serve_font(filename):
    """Serve font files"""
    return send_file(f'/home/admin/clock/font/{filename}')


@app.route('/orientation')
def orientation():
    """Return current orientation data as JSON"""
    display_angle = sensor.get_display_angle()
    shake = sensor.shaking
    if shake:
        sensor.shaking = False

    return jsonify({
        'display_angle': display_angle,
        'shake': shake,
    })


@app.route('/stream')
def event_stream():
    """Server-Sent Events stream for orientation, shake, and winding events"""
    def generate():
        last_angle = None

        while True:
            display_angle = sensor.get_display_angle()

            # Consume shake flag
            shake = sensor.shaking
            if shake:
                sensor.shaking = False

            # Consume encoder delta
            delta = encoder.get_delta()

            # Send if anything changed
            changed = shake or delta != 0 or last_angle is None or abs(display_angle - last_angle) > 0.5

            if changed:
                output_data = {
                    'display_angle': display_angle,
                }
                if shake:
                    output_data['shake'] = True
                if delta != 0:
                    output_data['wind'] = delta

                yield f"data: {json.dumps(output_data)}\n\n"
                last_angle = display_angle

            time.sleep(UPDATE_RATE)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )


@app.route('/health')
def health():
    """Health check endpoint with debug info"""
    data = sensor.get_data()
    return jsonify({
        'status': 'ok',
        'sensor': {
            'active': sensor.sensor_type is not None,
            'type': sensor.sensor_type or 'simulation'
        },
        'encoder': {
            'active': encoder.device is not None,
            'device': encoder.event_device if encoder.device else None
        },
        'current_reading': {
            'display_angle': round(data['display_angle'], 1),
            'raw_angle': round(data.get('raw_angle', data['display_angle']), 1),
        },
        'config': {
            'smoothing': SMOOTHING_FACTOR,
            'update_rate_hz': int(1 / UPDATE_RATE),
            'shake_threshold': sensor._shake_threshold,
            'shake_reversals': sensor._shake_reversals_needed,
        },
    })


def run_server():
    """Run the Flask server"""
    print("=" * 50)
    print("Auto-Rotating Clock Server (Sense HAT)")
    print("=" * 50)
    print()
    print("Starting server on http://0.0.0.0:5000")
    print("Access from browser: http://localhost:5000")
    print()
    
    # Run server
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)


if __name__ == '__main__':
    try:
        run_server()
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        sensor.stop_reading()