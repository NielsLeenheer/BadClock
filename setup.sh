#!/bin/bash

# Auto-Rotating Clock Setup Script
# For Raspberry Pi 4B with Waveshare circular display and Pi Sensor Hat

set -e

echo "=========================================="
echo "Auto-Rotating Clock Setup"
echo "=========================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo; then
    echo -e "${YELLOW}Warning: This doesn't appear to be a Raspberry Pi${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 1: Enable I2C
echo -e "${GREEN}Step 1: Enabling I2C interface...${NC}"
if ! grep -q "^dtparam=i2c_arm=on" /boot/config.txt; then
    echo "dtparam=i2c_arm=on" | sudo tee -a /boot/config.txt
    echo "i2c-dev" | sudo tee -a /etc/modules
    echo -e "${YELLOW}I2C enabled. A reboot will be required.${NC}"
else
    echo "I2C already enabled"
fi

# Step 2: Install system dependencies
echo
echo -e "${GREEN}Step 2: Installing system dependencies...${NC}"
sudo apt-get update
sudo apt-get install -y python3-pip i2c-tools python3-flask python3-flask-cors sense-hat

# Step 3: Install Python packages (if not available via apt)
echo
echo -e "${GREEN}Step 3: Installing any remaining Python packages...${NC}"
pip3 install --break-system-packages -r "$SCRIPT_DIR/requirements.txt" 2>/dev/null || echo "Using system packages"

# Step 4: Test I2C connection
echo
echo -e "${GREEN}Step 4: Testing I2C connection...${NC}"
if command -v i2cdetect &> /dev/null; then
    echo "Scanning I2C bus 1..."
    sudo i2cdetect -y 1
    echo
    echo "Look for address 0x6a (LSM9DS1 - Sense HAT) or 0x68 (MPU sensor)."
else
    echo "i2cdetect not available, skipping test"
fi

# Step 5: Create systemd service
echo
echo -e "${GREEN}Step 5: Creating systemd service...${NC}"

SERVICE_FILE="/etc/systemd/system/clock-server.service"

# Detect current user (but not root)
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" = "root" ]; then
    CURRENT_USER="admin"  # Default to admin if running as root
fi

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Auto-Rotating Clock Server
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/server.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Systemd service created at $SERVICE_FILE"

# Step 6: Enable and start service
echo
echo -e "${GREEN}Step 6: Enabling and starting service...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable clock-server.service
sudo systemctl start clock-server.service

sleep 2

# Check service status
if sudo systemctl is-active --quiet clock-server.service; then
    echo -e "${GREEN}âœ“ Service is running!${NC}"
else
    echo -e "${RED}âœ— Service failed to start${NC}"
    echo "Check logs with: sudo journalctl -u clock-server -f"
fi

# Step 7: Configure PiOSK
echo
echo -e "${GREEN}Step 7: PiOSK Configuration${NC}"
echo "To configure PiOSK to show your clock at boot:"
echo
echo "1. Edit your PiOSK configuration (usually in ~/.config/piosk/ or /boot/)"
echo "2. Set the URL to: http://localhost:5000"
echo "3. Enable fullscreen/kiosk mode"
echo
echo "Example configuration:"
echo "  URL=http://localhost:5000"
echo "  FULLSCREEN=true"
echo

# Step 8: Final instructions
echo -e "${GREEN}=========================================="
echo "Setup Complete!"
echo "==========================================${NC}"
echo
echo "Your clock server is running on port 5000"
echo
echo "Useful commands:"
echo "  â€¢ Check status:  sudo systemctl status clock-server"
echo "  â€¢ View logs:     sudo journalctl -u clock-server -f"
echo "  â€¢ Restart:       sudo systemctl restart clock-server"
echo "  â€¢ Stop:          sudo systemctl stop clock-server"
echo "  â€¢ Test in browser: http://localhost:5000"
echo
echo "Access from the Pi browser to see your clock!"
echo

# Check if reboot needed
if ! lsmod | grep -q i2c_dev; then
    echo -e "${YELLOW}âš  A reboot is required to enable I2C${NC}"
    read -p "Reboot now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo reboot
    fi
fi