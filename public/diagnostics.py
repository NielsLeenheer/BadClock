#!/usr/bin/env python3
"""
Pi Sensor Hat diagnostic tool
Identifies sensors on I2C bus and tests accelerometer readings
"""

import smbus
import time

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
        0x1c: "LIS3DH Accelerometer or LSM9DS1 Magnetometer",
        0x1d: "ADXL345 Accelerometer (possible)",
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

if __name__ == '__main__':
    main()