#!/bin/bash
# Install Python dependencies for auto-fetch script

echo "📦 Installing Python dependencies for auto-fetch..."

# Check if pip3 is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 not found. Please install Python 3 first."
    exit 1
fi

# Install required packages (with --break-system-packages for macOS)
pip3 install --user --break-system-packages \
    requests \
    psycopg2-binary \
    smartapi-python \
    pyotp \
    logzero \
    python-dotenv

echo "✅ Dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "1. Run: chmod +x scripts/setup-auto-fetch.sh"
echo "2. Run: ./scripts/setup-auto-fetch.sh"
