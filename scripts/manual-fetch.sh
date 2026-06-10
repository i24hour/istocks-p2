#!/bin/bash
# Manual run of auto-fetch script with colored output

PROJECT_DIR="/Users/priyanshu/Desktop/Desktop/Github/istocks-p"
cd "$PROJECT_DIR"

echo "🚀 Manually running stock data auto-fetch..."
echo "⏰ Started at: $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

python3 scripts/auto-fetch-stock-data.py

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Completed at: $(date)"
