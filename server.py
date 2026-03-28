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

app = Flask(__name__)
CORS(app)

# ============================================================
# SENSOR CONFIGURATION
# ============================================================
SMOOTHING_FACTOR = 0.3    # Exponential smoothing (0.0=no smoothing, 1.0=max smoothing)
UPDATE_RATE = 0.05        # Sensor update rate in seconds (20Hz)
# ============================================================

class SensorReader:
    """
    Read orientation data from Raspberry Pi Sense HAT
    Uses built-in sensor fusion for stable readings
    """
    
    def __init__(self):
        self.sense = None
        self.orientation_data = {
            'display_angle': 0,
            'accel_x_raw': 0,
            'accel_y_raw': -1,
            'accel_x': 0,
            'accel_y': 1,
            'accel_z': 0
        }
        self.shake_data = {'x': 0, 'y': -1, 'z': 0}  # Separate for shake detection
        self.running = False
        self.smoothed_angle = 0  # Smoothed display angle
        
        self.initialize()
    
    def initialize(self):
        """Initialize Sense HAT"""
        try:
            from sense_hat import SenseHat
            import smbus
            
            self.sense = SenseHat()
            self.i2c_bus = smbus.SMBus(1)  # For direct sensor access
            
            # Configure IMU (enable all sensors for fusion)
            self.sense.set_imu_config(True, True, True)  # Compass, Gyro, Accel
            
            print("✓ Sense HAT initialized")
            print("  Using: Accelerometer (smoothed with gyro/compass)")
            print("  Calculating: Display rotation from gravity projection")
            print("  Shake detection: Direct I2C reads for unfiltered data")
            print()
            print("  Coordinate system (corrected):")
            print("    - Device upright (12 at top) → 0°")
            print("    - Rotated 90° clockwise → 90°")
            print("    - Upside down (12 at bottom) → 180°")
            print("    - Rotated 90° counter-clockwise → 270°")
            print()
            return True
            
        except ImportError:
            print("⚠ Sense HAT library not installed")
            print("  Install with: sudo apt-get install sense-hat")
            print("  Running in simulation mode")
            self.sense = None
            return False
        except Exception as e:
            print(f"⚠ Sense HAT initialization failed: {e}")
            print("  Running in simulation mode")
            self.sense = None
            return False
    
    def read_raw_accel_for_shake(self):
        """Read raw accelerometer without fusion - for shake detection"""
        if self.sense is None:
            return {'x': 0, 'y': -1, 'z': 0}
        
        try:
            # Temporarily use only accelerometer (disable fusion) for true raw readings
            # This gives us the motion spikes needed for shake detection
            self.sense.set_imu_config(False, False, True)  # Compass, Gyro, Accel
            accel = self.sense.get_accelerometer_raw()
            
            # Re-enable full fusion for next orientation read
            self.sense.set_imu_config(True, True, True)
            
            return {
                'x': accel['x'],
                'y': accel['y'],
                'z': accel['z']
            }
        except:
            return {'x': 0, 'y': -1, 'z': 0}
    
    def read_orientation(self):
        """Read orientation and calculate display rotation from gravity"""
        if self.sense is None:
            # Simulation mode - return rotating values for testing
            t = time.time()
            angle = (t * 30) % 360  # Rotate 30°/second
            return {'display_angle': angle}
        
        try:
            # Get raw accelerometer data - tells us which way gravity points
            accel = self.sense.get_accelerometer_raw()
            
            # accel gives us gravity vector in device coordinates
            # We want to know: on the screen surface, which way is down?
            
            # Assuming screen is in XY plane (Z is perpendicular to screen)
            # We want the angle of gravity's projection onto the screen
            x = accel['x']
            y = -accel['y']  # Negate Y to match display coordinate system
            # z = accel['z']  # We don't need this for screen rotation
            
            # Calculate angle: which way does gravity point on the screen?
            # atan2 gives us the angle in radians
            angle_rad = math.atan2(x, y)  # Note: x, y order matters!
            angle_deg = math.degrees(angle_rad)
            
            # Normalize to 0-360
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
                
                # Update stored data with both smoothed angle and raw shake data
                self.orientation_data = {
                    'display_angle': smoothed,
                    'raw_angle': raw_angle,
                    'accel_x_raw': shake_accel['x'],  # Unsmoothed for shake detection
                    'accel_y_raw': shake_accel['y'],  # Unsmoothed for shake detection
                    'accel_x': raw_data.get('accel_x', 0),
                    'accel_y': raw_data.get('accel_y', 1),
                    'accel_z': shake_accel['z']  # Unsmoothed for shake detection
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


@app.route('/')
def index():
    """Serve the clock HTML page"""
    return send_file('/home/admin/clock/clock.html')


@app.route('/orientation')
def orientation():
    """Return current orientation data as JSON"""
    data = sensor.get_data()
    display_angle = sensor.get_display_angle()
    
    # Return raw accelerometer data for clock's shake detection
    # Plus pre-calculated display_angle to avoid double transformation
    return jsonify({
        'x': data.get('accel_x_raw', 0),
        'y': data.get('accel_y_raw', -1),
        'z': data.get('accel_z', 0),
        'display_angle': display_angle
    })


@app.route('/orientation/stream')
def orientation_stream():
    """Server-Sent Events stream for real-time orientation updates"""
    def generate():
        last_angle = None
        
        while True:
            current_data = sensor.get_data()
            display_angle = sensor.get_display_angle()
            
            # Send raw accelerometer data for shake detection
            # Plus pre-calculated display_angle
            output_data = {
                'x': current_data.get('accel_x_raw', 0),
                'y': current_data.get('accel_y_raw', -1),
                'z': current_data.get('accel_z', 0),
                'display_angle': display_angle
            }
            
            # Only send if angle has changed significantly
            if last_angle is None or abs(display_angle - last_angle) > 0.5:
                # Format as SSE
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
        'sensor_active': sensor.sense is not None,
        'sensor_type': 'Sense HAT (Gravity Projection)',
        'current_reading': {
            'display_angle': round(data['display_angle'], 1),
            'raw_angle': round(data.get('raw_angle', data['display_angle']), 1),
            'accelerometer': {
                'x': round(data.get('accel_x_raw', 0), 3),
                'y': round(data.get('accel_y_raw', -1), 3),
                'z': round(data.get('accel_z', 0), 3)
            }
        },
        'config': {
            'smoothing': SMOOTHING_FACTOR,
            'update_rate_hz': int(1 / UPDATE_RATE)
        },
        'info': 'Display angle = atan2(accel_x, -accel_y) with exponential smoothing'
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