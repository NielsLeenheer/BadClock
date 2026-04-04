#!/usr/bin/env python3
"""
Pi Sensor Hat diagnostic tool
Identifies sensors on I2C bus and tests accelerometer readings
"""

import smbus
import time
import math
import sys

def scan_i2c():
    """Scan I2C bus and identify known sensors"""
    print("=" * 60)
    print("I2C Sensor Scanner")
    print("=" * 60)
    print()
    
    bus = smbus.SMBus(1)
    devices_found = []
    
    print("Scanning I2C bus 1...")
    for addr in range(0x03, 0x78):
        try:
            bus.read_byte(addr)
            devices_found.append(addr)
        except:
            pass
    
    if not devices_found:
        print("❌ No I2C devices found!")
        return None
    
    print(f"✓ Found {len(devices_found)} device(s):")
    print()
    
    # Known sensor IDs
    sensor_info = {
        0x19: "LSM303DLHC Accelerometer (Adafruit)",
        0x1c: "LIS3DH Accelerometer or LSM9DS1 Magnetometer",
        0x1d: "ADXL345 Accelerometer (possible)",
        0x1e: "LSM303DLHC Magnetometer (Adafruit)",
        0x39: "TSL2561 Light Sensor / APDS-9960",
        0x46: "Unknown (kernel driver active)",
        0x53: "ADXL345 Accelerometer",
        0x5c: "AM2320 Temp/Humidity",
        0x5f: "HTS221 Humidity",
        0x68: "MPU6050/MPU9250 IMU",
        0x69: "MPU6050/MPU9250 IMU (alt address)",
        0x6a: "LSM6DS3 or LSM9DS1 IMU (Sense HAT)",
        0x6b: "LSM9DS1 IMU",
    }
    
    for addr in devices_found:
        info = sensor_info.get(addr, "Unknown device")
        print(f"  0x{addr:02x}: {info}")
    
    print()
    return bus, devices_found

def test_mpu(bus, addr):
    """Test MPU6050/MPU9250"""
    try:
        # Wake up
        bus.write_byte_data(addr, 0x6B, 0)
        time.sleep(0.1)
        
        # Read WHO_AM_I
        who = bus.read_byte_data(addr, 0x75)
        print(f"  WHO_AM_I: 0x{who:02x}")
        
        # Read accel
        high = bus.read_byte_data(addr, 0x3B)
        low = bus.read_byte_data(addr, 0x3C)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536
        ax = value / 16384.0
        
        print(f"  Accel X: {ax:.3f}g")
        print(f"  ✓ MPU sensor working!")
        return True
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def test_lsm(bus, addr):
    """Test LSM6DS3 or LSM9DS1"""
    try:
        # Read WHO_AM_I
        who = bus.read_byte_data(addr, 0x0F)
        print(f"  WHO_AM_I: 0x{who:02x}")
        
        if who == 0x69:
            print(f"  Identified as: LSM6DS3")
            # Enable accelerometer
            bus.write_byte_data(addr, 0x10, 0x40)
            time.sleep(0.1)
            variant = 'LSM6DS3'
        elif who == 0x68:
            print(f"  Identified as: LSM9DS1 (Raspberry Pi Sense HAT)")
            # Enable accelerometer - CTRL_REG5_XL (enable all axes)
            bus.write_byte_data(addr, 0x1F, 0x38)
            # CTRL_REG6_XL (ODR=119Hz, ±2g scale)
            bus.write_byte_data(addr, 0x20, 0x60)
            time.sleep(0.1)
            variant = 'LSM9DS1'
        else:
            print(f"  Unknown WHO_AM_I value")
            return False
        
        # Read accel
        low = bus.read_byte_data(addr, 0x28)
        high = bus.read_byte_data(addr, 0x29)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536
        ax = value / 16384.0
        
        print(f"  Accel X: {ax:.3f}g")
        print(f"  ✓ {variant} sensor working!")
        return True
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def test_lsm303dlhc(bus):
    """Test LSM303DLHC accelerometer at 0x19"""
    addr = 0x19
    try:
        # Read WHO_AM_I — LSM303DLHC accel doesn't have a standard WHO_AM_I,
        # but we can verify by enabling and reading data
        # CTRL_REG1_A: enable all axes, 50Hz
        bus.write_byte_data(addr, 0x20, 0x47)
        time.sleep(0.1)

        # Read accel X (registers 0x28-0x29)
        low = bus.read_byte_data(addr, 0x28)
        high = bus.read_byte_data(addr, 0x29)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536
        # Default scale is ±2g, 12-bit left-justified: divide by 16 then by 1000 for g
        ax = value / 16384.0

        # Read accel Y
        low = bus.read_byte_data(addr, 0x2A)
        high = bus.read_byte_data(addr, 0x2B)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536
        ay = value / 16384.0

        # Read accel Z
        low = bus.read_byte_data(addr, 0x2C)
        high = bus.read_byte_data(addr, 0x2D)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536
        az = value / 16384.0

        print(f"  Accel: x:{ax:.3f}g  y:{ay:.3f}g  z:{az:.3f}g")
        print(f"  ✓ LSM303DLHC accelerometer working!")
        return True
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False


def test_lsm303dlhc_mag(bus):
    """Test LSM303DLHC magnetometer at 0x1E"""
    addr = 0x1e
    try:
        # CRA_REG_M: 15Hz output rate
        bus.write_byte_data(addr, 0x00, 0x10)
        # MR_REG_M: continuous conversion
        bus.write_byte_data(addr, 0x02, 0x00)
        time.sleep(0.1)

        # Read mag X (registers 0x03-0x04, big-endian)
        high = bus.read_byte_data(addr, 0x03)
        low = bus.read_byte_data(addr, 0x04)
        value = (high << 8) | low
        if value > 32768:
            value -= 65536

        print(f"  Mag X raw: {value}")
        print(f"  ✓ LSM303DLHC magnetometer working!")
        return True
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False


def test_lis3dh(bus, addr):
    """Test LIS3DH"""
    try:
        # Read WHO_AM_I
        who = bus.read_byte_data(addr, 0x0F)
        print(f"  WHO_AM_I: 0x{who:02x} (expected: 0x33)")
        
        if who == 0x33:
            # Enable accelerometer
            bus.write_byte_data(addr, 0x20, 0x57)
            time.sleep(0.1)
            
            # Read accel
            low = bus.read_byte_data(addr, 0x28)
            high = bus.read_byte_data(addr, 0x29)
            value = (high << 8) | low
            if value > 32768:
                value -= 65536
            ax = value / 16384.0
            
            print(f"  Accel X: {ax:.3f}g")
            print(f"  ✓ LIS3DH sensor working!")
            return True
        return False
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def main():
    result = scan_i2c()
    if result is None:
        return
    
    bus, devices = result
    
    print("=" * 60)
    print("Testing Accelerometers")
    print("=" * 60)
    print()
    
    # Test each potential accelerometer
    found_accel = False
    
    for addr in [0x68, 0x69]:
        if addr in devices:
            print(f"Testing MPU at 0x{addr:02x}:")
            if test_mpu(bus, addr):
                found_accel = True
            print()
    
    if 0x6a in devices:
        print(f"Testing LSM (LSM6DS3/LSM9DS1) at 0x6a:")
        if test_lsm(bus, 0x6a):
            found_accel = True
        print()
    
    if 0x19 in devices:
        print(f"Testing LSM303DLHC accelerometer at 0x19:")
        if test_lsm303dlhc(bus):
            found_accel = True
        print()

    if 0x1e in devices:
        print(f"Testing LSM303DLHC magnetometer at 0x1e:")
        test_lsm303dlhc_mag(bus)
        print()

    if 0x1c in devices:
        print(f"Testing LIS3DH at 0x1c:")
        if test_lis3dh(bus, 0x1c):
            found_accel = True
        print()
    
    if found_accel:
        print("=" * 60)
        print("✓ Accelerometer found and working!")
        print("Your clock server should work correctly.")
    else:
        print("=" * 60)
        print("❌ No working accelerometer detected")
        print()
        print("Possible issues:")
        print("  • Sensor hat not properly connected")
        print("  • Different sensor model (check hat documentation)")
        print("  • Faulty sensor")
        print()
        print("The clock will run in simulation mode.")

def live_lsm303dlhc(bus):
    """Continuously print LSM303DLHC accel readings for axis calibration"""
    print("=" * 60)
    print("LSM303DLHC Live Readings")
    print("=" * 60)
    print("Rotate the device and observe x, y, z values.")
    print("Press Ctrl+C to stop.")
    print()

    # Enable: 50Hz, all axes
    bus.write_byte_data(0x19, 0x20, 0x47)
    bus.write_byte_data(0x19, 0x23, 0x08)
    time.sleep(0.1)

    try:
        while True:
            data = bus.read_i2c_block_data(0x19, 0x28 | 0x80, 6)
            raw_x = (data[1] << 8 | data[0])
            raw_y = (data[3] << 8 | data[2])
            raw_z = (data[5] << 8 | data[4])
            if raw_x > 32767: raw_x -= 65536
            if raw_y > 32767: raw_y -= 65536
            if raw_z > 32767: raw_z -= 65536
            x = raw_x / 16384.0
            y = raw_y / 16384.0
            z = raw_z / 16384.0

            angle = math.degrees(math.atan2(-y, x))
            if angle < 0: angle += 360

            print(f"\r  x:{x:+.3f}  y:{y:+.3f}  z:{z:+.3f}  → angle:{angle:5.1f}°  ", end='', flush=True)
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n\nStopped.")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'live':
        result = scan_i2c()
        if result and 0x19 in result[1]:
            live_lsm303dlhc(result[0])
        else:
            print("LSM303DLHC not found at 0x19")
    else:
        main()