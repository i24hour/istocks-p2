#!/bin/bash
# Check auto-fetch status and show latest data

PROJECT_DIR="/Users/priyanshu/Desktop/Desktop/Github/istocks-p"
LOG_DIR="$PROJECT_DIR/logs/auto-fetch"

echo "📊 iStocks Auto-Fetch Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if cron job is installed
echo "🔧 Cron Job Status:"
if crontab -l 2>/dev/null | grep -q "iStocks Auto-Fetch"; then
    echo "   ✅ ACTIVE - Auto-fetch is running"
    echo ""
    echo "   Schedule:"
    crontab -l | grep -A2 "Every 15 minutes"
else
    echo "   ❌ NOT ACTIVE - Run ./scripts/setup-cron-autofetch.sh"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check latest database record
echo "📅 Latest Data in Database:"
cd "$PROJECT_DIR"
python3 -c "
import os
from dotenv import load_dotenv
import psycopg2

load_dotenv('.env.local')
db_url = os.getenv('DATABASE_URL')
if 'priyanshu@123' in db_url:
    db_url = db_url.replace('priyanshu@123', 'priyanshu%40123')

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # Get latest record
    cur.execute('''
        SELECT timestamp, close, high, low, volume 
        FROM \"StockPrice\" 
        WHERE \"stockId\" = 'cmi2cmbzn0000ne9p2v0g98ry'
        ORDER BY timestamp DESC 
        LIMIT 1
    ''')
    
    row = cur.fetchone()
    if row:
        print(f'   📌 Timestamp: {row[0]}')
        print(f'   💰 Close: ₹{row[1]:.2f}')
        print(f'   📈 High: ₹{row[2]:.2f}')
        print(f'   📉 Low: ₹{row[3]:.2f}')
        print(f'   📊 Volume: {row[4]:,}')
    else:
        print('   ⚠️  No data found')
    
    # Get total records
    cur.execute('SELECT COUNT(*) FROM \"StockPrice\" WHERE \"stockId\" = \'cmi2cmbzn0000ne9p2v0g98ry\'')
    count = cur.fetchone()[0]
    print(f'\\n   📚 Total Records: {count:,}')
    
    cur.close()
    conn.close()
except Exception as e:
    print(f'   ❌ Database error: {str(e)}')
" 2>/dev/null || echo "   ❌ Could not connect to database"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check logs
echo "📝 Recent Logs:"
if [ -f "$LOG_DIR/output.log" ]; then
    echo "   Last 5 runs:"
    grep -E "(Starting auto-fetch|Successfully saved|Script completed)" "$LOG_DIR/output.log" | tail -15
else
    echo "   ⚠️  No logs yet (will appear after first cron run)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📖 Quick Commands:"
echo "   Manual fetch:  ./scripts/manual-fetch.sh"
echo "   View logs:     tail -f logs/auto-fetch/output.log"
echo "   Stop cron:     crontab -e (delete iStocks lines)"
echo "   Restart:       ./scripts/setup-cron-autofetch.sh"
