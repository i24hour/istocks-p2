#!/bin/bash
# ==============================================
# EC2 Deployment Script for iStocks Live Server
# ==============================================
# Run this script on a fresh Ubuntu EC2 instance
# 
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ==============================================

set -e

echo "🚀 Starting iStocks Live Server Deployment..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Python 3.11+
echo "🐍 Installing Python..."
sudo apt install -y python3 python3-pip python3-venv

# Create app directory
echo "📁 Creating app directory..."
sudo mkdir -p /opt/istocks-live
sudo chown $USER:$USER /opt/istocks-live
cd /opt/istocks-live

# Create virtual environment
echo "🔧 Setting up virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Copy files (you should SCP these from your local machine first)
# scp -r ec2-live-server/* ubuntu@YOUR_EC2_IP:/opt/istocks-live/

# Install dependencies
echo "📥 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create environment file
echo "🔐 Creating environment file..."
cat > .env << 'EOF'
ANGEL_API_KEY=bpH7FOsU
ANGEL_CLIENT_ID=P528293
ANGEL_PASSWORD=5293
ANGEL_TOTP_SECRET=DSMCAQQPKJODZ4WZT2KQXUIVWU
EOF

# Create systemd service
echo "⚙️ Creating systemd service..."
sudo tee /etc/systemd/system/istocks-live.service > /dev/null << 'EOF'
[Unit]
Description=iStocks Live Price Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/istocks-live
Environment=PATH=/opt/istocks-live/venv/bin
EnvironmentFile=/opt/istocks-live/.env
ExecStart=/opt/istocks-live/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo "🔄 Starting service..."
sudo systemctl daemon-reload
sudo systemctl enable istocks-live
sudo systemctl start istocks-live

# Check status
echo "✅ Deployment complete!"
echo ""
echo "Check service status:"
echo "  sudo systemctl status istocks-live"
echo ""
echo "View logs:"
echo "  sudo journalctl -u istocks-live -f"
echo ""
echo "API available at:"
echo "  http://YOUR_EC2_IP:8080/health"
echo "  http://YOUR_EC2_IP:8080/prices"
