# 🤖 Auto-Fetch Stock Data - Setup Guide

## ✅ What This Does

1. **Automatically fetches missing data** from Angel One API
2. **Saves directly to PostgreSQL** database
3. **Runs daily** after market close (4:00 PM)
4. **Handles API rate limits** with smart chunking
5. **Avoids duplicates** with conflict handling

## 📋 Prerequisites

```bash
# Install required Python packages
pip3 install requests psycopg2-binary SmartApi pyotp logzero python-dotenv
```

## 🚀 Initial Setup

### 1. Make scripts executable

```bash
chmod +x scripts/run-auto-fetch.sh
chmod +x scripts/auto-fetch-stock-data.py
```

### 2. Run once manually to fetch missing data (Nov 14 - Nov 21)

```bash
cd /Users/priyanshu/Desktop/Desktop/Github/istocks-p
python3 scripts/auto-fetch-stock-data.py
```

This will:

- Check last date in database (Nov 14)
- Fetch all missing data till today (Nov 21, 3:30 PM)
- Insert into database automatically

### 3. Set up automatic daily execution

**Option A: Using crontab (Recommended)**

```bash
# Open crontab editor
crontab -e

# Add this line (runs every day at 4:00 PM)
0 16 * * 1-5 /Users/priyanshu/Desktop/Desktop/Github/istocks-p/scripts/run-auto-fetch.sh
```

**Option B: Using macOS launchd**

Create file: `~/Library/LaunchAgents/com.istocks.autofetch.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.istocks.autofetch</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/priyanshu/Desktop/Desktop/Github/istocks-p/scripts/run-auto-fetch.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>16</integer>
        <key>Minute</key>
        <integer>0</integer>
        <key>Weekday</key>
        <integer>1</integer>
    </dict>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.istocks.autofetch.plist
```

## 📊 How It Works

### Daily Schedule:

- **9:15 AM** - Market opens
- **3:30 PM** - Market closes
- **4:00 PM** - Auto-fetch runs automatically

### Process Flow:

```
1. Check last timestamp in database
2. Calculate missing date range
3. Fetch data in 1-day chunks (to avoid API limits)
4. Wait 500ms between API calls (rate limit protection)
5. Insert into PostgreSQL (skips duplicates)
6. Log results
```

### API Rate Limit Handling:

- Fetches **1 day at a time**
- **500ms delay** between requests
- Maximum ~7 days of 1-min data per run
- Safe for daily execution

## 🔍 Monitoring

### Check logs:

```bash
# View today's log
tail -f logs/auto-fetch-$(date +%Y-%m-%d).log

# View all logs
ls -la logs/

# Check if cron job is running
crontab -l
```

### Verify data in database:

```bash
psql -d stock_analysis -c "
SELECT
    DATE(timestamp) as date,
    COUNT(*) as records,
    MIN(timestamp) as first_record,
    MAX(timestamp) as last_record
FROM \"StockPrice\"
WHERE \"stockId\" = 'cmi2cmbzn0000ne9p2v0g98ry'
GROUP BY DATE(timestamp)
ORDER BY date DESC
LIMIT 10;
"
```

## 🛠️ Manual Execution

```bash
# Fetch latest data now
python3 scripts/auto-fetch-stock-data.py

# Fetch specific date range (edit script first)
# Modify start_date and end_date in main() function
```

## 📝 Configuration

Edit `/scripts/auto-fetch-stock-data.py` to change:

- **Stock Symbol**: Change `STOCK_NAME = "WIPRO"`
- **Stock ID**: Update `STOCK_ID` from database
- **Time Range**: Modify in `main()` function
- **Chunk Size**: Change `timedelta(days=1)` in `fetch_data_in_chunks()`

## ⚠️ Important Notes

1. **Market Hours**: Only fetches during trading days (Mon-Fri)
2. **Duplicates**: Automatically skipped using `ON CONFLICT DO NOTHING`
3. **API Limits**: Respects rate limits with delays
4. **Missing Days**: Automatically fills gaps when running
5. **Weekends/Holidays**: No data available, script handles gracefully

## 🐛 Troubleshooting

**Issue**: Authentication failed

```bash
# Check TOTP token is correct
# Regenerate in Angel One dashboard
```

**Issue**: Database connection failed

```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql postgresql://priyanshu@localhost:5432/stock_analysis
```

**Issue**: No data fetched

```bash
# Check market hours (9:15 AM - 3:30 PM IST, Mon-Fri)
# Verify stock symbol is correct
```

## 📈 Expected Data Volume

- **1 minute interval** = ~375 records per day (6.5 trading hours)
- **1 day** = ~3-5 KB in database
- **1 month** = ~7,500 records (~100 KB)
- **1 year** = ~93,750 records (~1.2 MB)

Very lightweight and efficient! ✅

## 🎉 Success Indicators

After first run, you should see:

```
✅ Token for WIPRO: <token>
✅ Successfully authenticated with Angel One
📅 Last data in database: 2025-11-14 15:29:00+05:30
📊 Fetching data from 2025-11-14 15:30:00 to 2025-11-21 15:30:00
✅ Fetched <count> total records
✅ Successfully saved <count> new records
✅ Logged out successfully
🏁 Script completed
```

---

**Author**: Auto-generated setup for iStocks Platform  
**Last Updated**: November 21, 2025
