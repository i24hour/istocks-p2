# 📊 Fetch Real 1-Minute Data from Angel One

Since the TypeScript/Node.js implementation is having issues with the Angel One API, we'll use your working Python script to fetch the data, then import it into the database.

## 🚀 Quick Steps

### Step 1: Run Python Script to Fetch Data

```bash
cd /Users/priyanshu/Desktop/Desktop/Github/istocks-p
python3 scripts/fetch-wipro-python.py
```

This will:
- ✅ Authenticate with Angel One using TOTP
- ✅ Fetch 1-minute candle data for last 30 days
- ✅ Save data to `scripts/wipro_1min_data.json`

### Step 2: Import JSON into Database

```bash
npm run db:import
```

This will:
- ✅ Read the JSON file
- ✅ Calculate all 40+ technical indicators
- ✅ Insert data into PostgreSQL database
- ✅ Show statistics

## 📝 What the Python Script Does

The script (`scripts/fetch-wipro-python.py`):

1. **Gets WIPRO token** from Angel One's scrip master
2. **Generates TOTP** for authentication
3. **Authenticates** with Angel One API
4. **Fetches data in chunks** (30-day chunks to avoid API limits)
5. **Saves to JSON** for import

### Date Range

- **From**: 30 days ago at 9:15 AM (market open)
- **To**: Yesterday at 3:30 PM (market close)
- **Interval**: 1 minute
- **Expected records**: ~7,500 (375 minutes/day × 20 trading days)

## 🔧 Requirements

Make sure you have Python dependencies installed:

```bash
pip install SmartApi pyotp requests
```

## 📊 Output

After running both scripts, you'll have:

- **JSON File**: `scripts/wipro_1min_data.json` with raw data
- **Database**: PostgreSQL with all records and calculated indicators
- **Statistics**: Total records, date range, price range, etc.

## 🎯 Example Output

### Python Script:
```
🚀 Starting Wipro data fetch...
✅ Found WIPRO token: 3787
Generated TOTP: 123456
✅ Successfully Authenticated
📅 Date range: 2024-10-17 09:15:00 to 2024-11-16 15:30:00
📊 Fetching data from 2024-10-17 09:15 to 2024-11-16 09:15
✅ Fetched 7245 records
✅ Total records fetched: 7245
✅ Data saved to wipro_1min_data.json
🎉 Done! Now run: npm run db:import
```

### Import Script:
```
🚀 Starting Wipro data import from JSON...
✅ Loaded 7245 records from JSON
✅ Wipro stock created/found
📊 Data range: 10/17/2024, 9:15:00 AM to 11/16/2024, 3:30:00 PM
🔢 Calculating technical indicators...
🗑️  Deleting existing Wipro data...
💾 Inserting data into database...
  Inserted 7245/7245 records (100.0%)
✅ Successfully inserted 7245 records
🎉 Wipro 1-minute data import completed!

📊 Database Statistics:
   Total records: 7245
   Date range: 10/17/2024 to 11/16/2024
   Price range: ₹235.50 to ₹248.75
   Average price: ₹242.15
```

## 🔍 Verify Data

Check the database:

```bash
psql stock_analysis -c "SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM \"StockPrice\";"
```

Check a sample record with indicators:

```bash
psql stock_analysis -c "SELECT timestamp, close, rsi, macd, sma20 FROM \"StockPrice\" ORDER BY timestamp DESC LIMIT 5;"
```

## ⚡ Quick Commands

```bash
# Fetch data from Angel One (Python)
npm run fetch:python

# Import JSON into database
npm run db:import

# Or run both manually:
python3 scripts/fetch-wipro-python.py && npm run db:import
```

## 🐛 Troubleshooting

### Python Script Issues

**Error: "Invalid Token"**
- Check TOTP_TOKEN in the script
- Ensure it matches your Angel One 2FA secret

**Error: "Authentication Failed"**
- Verify API_KEY, CLIENT_ID, SECRET_KEY
- Check if your Angel One account is active

**Error: "No data fetched"**
- The date range might be invalid
- Try adjusting the dates in the script
- Check if market was open on those days

### Import Script Issues

**Error: "File not found"**
- Run the Python script first
- Check if `wipro_1min_data.json` exists in `scripts/` folder

**Error: "Database connection failed"**
- Ensure PostgreSQL is running
- Check DATABASE_URL in `.env.local`

## 📈 What You Get

After successful import, your database will have:

### For Each 1-Minute Candle:
- **OHLCV Data**: Open, High, Low, Close, Volume
- **Trend Indicators**: SMA (20, 50, 200), EMA (12, 26), MACD, ADX
- **Momentum**: RSI, Stochastic, CCI, Williams %R, ROC
- **Volatility**: Bollinger Bands, ATR
- **Volume**: OBV, VWAP, Force Index, A/D Line

### Total: 40+ Technical Indicators per record!

## 🎉 Next Steps

Once data is imported:

1. **Restart dev server**: `npm run dev`
2. **Visit**: http://localhost:3000/stock/WIPRO
3. **See real data** in charts and indicators
4. **Chat with AI** about the real market data!

---

**Note**: The Python script uses your exact credentials and proven working code, so it should fetch data successfully!
