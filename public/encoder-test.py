#!/usr/bin/env python3
"""
Rotary encoder diagnostic and test tool.
Run this to verify the encoder is connected and working before testing the web UI.
"""

import sys
import os
from pathlib import Path

def test_evdev():
    """Test if evdev is installed"""
    try:
        from evdev import InputDevice, ecodes
        print("✓ evdev library installed")
        return True
    except ImportError:
        print("✗ evdev not installed")
        print("  Install with: sudo apt install python3-evdev")
        return False

def find_encoder_device():
    """Scan /dev/input/event* for rotary encoder"""
    try:
        from evdev import InputDevice, categorize
    except ImportError:
        return None

    print("\nScanning /dev/input for devices...")
    found_devices = []

    for i in range(20):  # Check event0 through event19
        event_path = f'/dev/input/event{i}'
        if not os.path.exists(event_path):
            continue

        try:
            dev = InputDevice(event_path)
            found_devices.append((i, dev.name))
            print(f"  event{i}: {dev.name}")
        except:
            pass

    if not found_devices:
        print("  No input devices found!")
        return None

    # Look for "rotary" or "encoder" in name
    for idx, name in found_devices:
        if 'rotary' in name.lower() or 'encoder' in name.lower():
            print(f"\n✓ Found encoder at /dev/input/event{idx}: {name}")
            return idx

    # If no explicit match, check device tree overlay
    print("\n⚠ No obvious encoder device found")
    print("  Have you added the device tree overlay?")
    print("  Check /boot/config.txt has:")
    print("  dtoverlay=rotary-encoder,pin_a=13,pin_b=12,relative_axis=1")
    return None

def test_encoder_reading(event_idx):
    """Listen to encoder and print events"""
    try:
        from evdev import InputDevice, ecodes
    except ImportError:
        return

    event_path = f'/dev/input/event{event_idx}'
    try:
        dev = InputDevice(event_path)
    except PermissionError:
        print(f"\n✗ Permission denied on {event_path}")
        print("  Run with sudo, or: sudo chmod a+r {event_path}")
        return
    except Exception as e:
        print(f"\n✗ Cannot open {event_path}: {e}")
        return

    print(f"\nListening on {event_path} ({dev.name})")
    print("Rotate the encoder now... (Press Ctrl+C to stop)")
    print("-" * 50)

    event_count = 0
    try:
        for event in dev.read_loop():
            if event.type == ecodes.EV_REL:
                direction = "→ CW" if event.value > 0 else "← CCW"
                event_count += 1
                print(f"[{event_count:3d}] {direction}  (delta: {event.value:+2d})")
            # Also show other event types for diagnostics
            elif event.type == ecodes.EV_KEY:
                key_name = f"button" if event.code == ecodes.BTN_LEFT else str(event.code)
                print(f"      KEY: {key_name} {'pressed' if event.value else 'released'}")

    except KeyboardInterrupt:
        print("\n" + "-" * 50)
        print(f"Stopped. Received {event_count} events.")
        if event_count == 0:
            print("\n✗ No events received! Check:")
            print("  1. Device tree overlay is loaded")
            print("  2. Encoder is wired correctly")
            print("  3. Encoder is actually rotating")
        else:
            print("\n✓ Encoder is working!")

def main():
    print("=" * 50)
    print("BadClock Rotary Encoder Diagnostic Tool")
    print("=" * 50)
    print()

    # Test evdev
    if not test_evdev():
        print("\nCannot proceed without evdev.")
        sys.exit(1)

    # Find encoder
    event_idx = find_encoder_device()
    if event_idx is None:
        print("\nCannot find encoder device.")
        print("Troubleshooting steps:")
        print("  1. SSH into Pi: ssh admin@<pi-ip>")
        print("  2. Check kernel modules: lsmod | grep rotary")
        print("  3. Check /boot/firmware/config.txt has rotary-encoder overlay")
        print("     dtoverlay=rotary-encoder,pin_a=13,pin_b=12,relative_axis=1")
        print("  4. Reboot if you just added it: sudo reboot")
        print("  5. Verify GPIO connections (CLK=GPIO13, DT=GPIO12, SW=GPIO6)")
        sys.exit(1)

    # Test reading
    test_encoder_reading(event_idx)

if __name__ == '__main__':
    main()
