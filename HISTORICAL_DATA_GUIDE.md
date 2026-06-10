# Historical Data Fetch Guide

## Current Database Status

- **Existing data**: Oct 17, 2025 - Nov 21, 2025 (9,015 records)
- **Gap to fill**: Jan 1, 2015 - Oct 16, 2025

## Angel One API Limitations

⚠️ **IMPORTANT CONSTRAINTS:**

1. **Historical Data Limit**: Angel One typically provides:

   - **1-minute data**: Last 30-100 days only
   - **Daily data**: Can go back several years
   - **Intraday historical data**: Very limited

2. **API Rate Limits**:

   - Max ~3 requests per second
   - Daily request limits apply
   - 1000 candles per request maximum

3. **Data Availability**:
   - Most brokers don't provide 10 years of 1-minute data via API
   - Historical 1-min data is typically not available beyond 30-90 days

## Realistic Approach

### Option 1: Fetch What's Available (Recommended)

```bash
# This will fetch whatever historical data Angel One provides
# Usually last 30-90 days of 1-minute data
python3 scripts/auto-fetch-stock-data.py
```

### Option 2: Use Alternative Data Sources

For true 10-year historical 1-minute data, you'll need:

1. **NSE Historical Data Portal**

   - Download CSV files from NSE website
   - Manual download, then import to database

2. **Commercial Data Providers**

   - AlgoBulls
   - TrueData
   - Refinitiv/Bloomberg
   - These charge for historical tick/minute data

3. **Yahoo Finance / Other Free Sources**
   - Daily/Weekly data available
   - No 1-minute granularity for old data

### Option 3: Aggregate Daily Data

If you just need price movements over years:

```bash
# Fetch daily OHLC data instead of 1-minute
# This is more realistic for 10-year historical analysis
```

## What I Can Help You Do

### 1. Fetch Maximum Available from Angel One

```bash
# Run the test first to see how far back we can go
python3 scripts/test-historical-data-availability.py

# Then fetch whatever is available
python3 scripts/fetch-historical-data.py
```

### 2. Import from CSV/Excel

If you have historical data files:

```bash
# Create an import script for your data files
python3 scripts/import-csv-data.py your_data.csv
```

### 3. Modify Chart to Show Available Data

Your chart will work with whatever data exists in the database.

- If you have 30 days: 1M, 3M, 6M, 1Y will show what's available
- If you have 1 year: All timeframes will work within that range

## Recommendation

**For a realistic stock analysis app:**

1. **Keep current setup**: Daily auto-fetch for new data ✅
2. **Fetch last 100 days**: What Angel One likely provides
3. **For older data**: Use daily/weekly aggregates, not 1-minute
4. **Display**: Charts adapt to available data automatically

**Why 10 years of 1-min data is impractical:**

- ~1.5 million records (10 years × 250 trading days × 375 minutes × 60 seconds)
- Storage: ~500 MB - 1 GB
- Query time: Slower chart loading
- API: Not available from free sources

**Better approach:**

- 1-minute data: Last 3 months (real-time analysis)
- 1-hour/Daily data: Last 10 years (long-term trends)

## Next Steps

Let me know which approach you prefer:

1. ✅ **Fetch maximum available** (30-100 days) from Angel One
2. 📊 **Use daily data** for historical analysis (more realistic)
3. 📁 **Import from files** if you have the data
4. 🔄 **Keep current setup** (Oct 17 - Nov 21) and build forward

What would you like to do?
