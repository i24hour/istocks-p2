#!/bin/bash
# Setup automatic stock data fetching for macOS using launchd

PROJECT_DIR="/Users/priyanshu/Desktop/Desktop/Github/istocks-p"
SCRIPT_PATH="$PROJECT_DIR/scripts/auto-fetch-stock-data.py"
LOG_DIR="$PROJECT_DIR/logs/auto-fetch"
PLIST_NAME="com.istocks.autofetch"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "🚀 Setting up automatic stock data fetching..."
echo ""

# Create log directory
mkdir -p "$LOG_DIR"
echo "✅ Created log directory: $LOG_DIR"

# Make Python script executable
chmod +x "$SCRIPT_PATH"
echo "✅ Made script executable"

# Create launchd plist file
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$SCRIPT_PATH</string>
    </array>
    
    <key>StartCalendarInterval</key>
    <array>
        <!-- Run every 5 minutes during market hours (9:15 AM - 3:30 PM) -->
        <!-- Monday to Friday only -->
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>20</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>10</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>11</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>13</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>14</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>15</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>15</integer>
            <key>Minute</key>
            <integer>35</integer>
        </dict>
        <!-- Repeat for Tuesday (2) through Friday (5) -->
        <dict>
            <key>Weekday</key>
            <integer>2</integer>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>20</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>3</integer>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>20</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>4</integer>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>20</integer>
        </dict>
        <dict>
            <key>Weekday</key>
            <integer>5</integer>
            <key>Hour</key>
            <integer>9</integer>
            <key>Minute</key>
            <integer>20</integer>
        </dict>
    </array>
    
    <key>StandardOutPath</key>
    <string>$LOG_DIR/output.log</string>
    
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/error.log</string>
    
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

echo "✅ Created launchd configuration: $PLIST_PATH"
echo ""

# Load the launchd job
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Successfully loaded auto-fetch job!"
    echo ""
    echo "📊 Auto-fetch is now active:"
    echo "   - Runs during market hours (9:15 AM - 3:30 PM)"
    echo "   - Monday to Friday only"
    echo "   - Fetches every hour + after market close"
    echo "   - Logs: $LOG_DIR"
    echo ""
    echo "🔧 Management commands:"
    echo "   Stop:  launchctl unload $PLIST_PATH"
    echo "   Start: launchctl load $PLIST_PATH"
    echo "   Test:  python3 $SCRIPT_PATH"
    echo "   Logs:  tail -f $LOG_DIR/output.log"
else
    echo "❌ Failed to load launchd job"
    exit 1
fi
