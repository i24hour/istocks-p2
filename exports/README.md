# Database Export - CSV Files

## 📊 Export Summary

**Export Date**: November 21, 2025  
**Total Records Exported**: 6,810 price records + 1 stock

---

## 📁 Exported Files

### 1. `stocks.csv` (198 bytes)
Contains all stock information from your database.

**Columns:**
- `id` - Unique stock identifier
- `symbol` - Stock symbol (e.g., WIPRO)
- `name` - Company name (e.g., Wipro)
- `exchange` - Stock exchange (e.g., NSE)
- `createdAt` - Record creation timestamp
- `updatedAt` - Last update timestamp

**Records**: 1 stock (WIPRO)

---

### 2. `stock_prices.csv` (4.1 MB)
Complete price data with all 40+ technical indicators.

**Columns:**
- **Basic Data**: id, stockId, timestamp, open, high, low, close, volume
- **Trend Indicators**: sma20, sma50, sma200, ema12, ema26, macd, macdSignal, macdHistogram, adx, plusDI, minusDI
- **Momentum Indicators**: rsi, stochK, stochD, cci, williamsR, roc
- **Volatility Indicators**: bbUpper, bbMiddle, bbLower, atr
- **Volume Indicators**: obv, vwap, forceIndex, adLine
- **Metadata**: createdAt

**Records**: 6,810 price records

---

### 3. `prices_with_symbols.csv` (2.6 MB) ⭐ **RECOMMENDED**
User-friendly version with stock symbols included. Best for analysis and viewing.

**Columns:**
- `symbol` - Stock symbol (WIPRO)
- `stockName` - Company name (Wipro)
- `timestamp` - Date and time
- `open`, `high`, `low`, `close`, `volume` - OHLCV data
- **Key Technical Indicators**:
  - `rsi` - Relative Strength Index
  - `macd`, `macdSignal` - MACD indicators
  - `sma20`, `sma50`, `sma200` - Simple Moving Averages
  - `ema12`, `ema26` - Exponential Moving Averages
  - `bbUpper`, `bbMiddle`, `bbLower` - Bollinger Bands
  - `atr` - Average True Range
  - `adx` - Average Directional Index
  - `stochK`, `stochD` - Stochastic Oscillator
  - `cci` - Commodity Channel Index
  - `williamsR` - Williams %R

**Records**: 6,810 records

---

## 🔍 How to Use

### Open in Excel
1. Open Microsoft Excel
2. Go to File → Open
3. Select the CSV file
4. Data will be automatically formatted

### Open in Google Sheets
1. Go to Google Sheets (sheets.google.com)
2. File → Import
3. Upload the CSV file
4. Choose "Replace current sheet" or "Insert new sheet"

### Open in Numbers (Mac)
1. Double-click the CSV file
2. Numbers will open automatically

### Open in Python/Pandas
```python
import pandas as pd

# Load the data
df = pd.read_csv('prices_with_symbols.csv')

# View first few rows
print(df.head())

# Get statistics
print(df.describe())

# Filter by date
df['timestamp'] = pd.to_datetime(df['timestamp'])
recent_data = df[df['timestamp'] > '2025-11-01']
```

### Open in R
```r
# Load the data
data <- read.csv('prices_with_symbols.csv')

# View structure
str(data)

# Summary statistics
summary(data)
```

---

## 📈 Data Analysis Tips

### 1. Find Overbought/Oversold Stocks
- **RSI > 70**: Overbought (potential sell signal)
- **RSI < 30**: Oversold (potential buy signal)

### 2. Identify Trends
- **Price > SMA200**: Long-term uptrend
- **Price < SMA200**: Long-term downtrend
- **SMA20 > SMA50 > SMA200**: Strong uptrend (Golden Cross)

### 3. Volatility Analysis
- **High ATR**: High volatility
- **Price near BB Upper**: Potentially overbought
- **Price near BB Lower**: Potentially oversold

### 4. Momentum Analysis
- **MACD > Signal**: Bullish momentum
- **MACD < Signal**: Bearish momentum
- **Stochastic K > 80**: Overbought
- **Stochastic K < 20**: Oversold

---

## 📊 Data Statistics

### WIPRO Stock Data
- **Total Records**: 6,810
- **Date Range**: Check the timestamp column for exact range
- **Timeframe**: 1-minute intervals
- **Technical Indicators**: 40+ indicators calculated

### Data Quality
- ✅ All OHLCV data present
- ✅ Technical indicators calculated
- ✅ No missing critical data
- ✅ Timestamps in chronological order

---

## 🔄 Re-exporting Data

To export the database again (with updated data):

```bash
npm run db:export
```

This will:
1. Connect to your PostgreSQL database
2. Export all tables to CSV format
3. Save files in the `exports/` directory
4. Overwrite existing files

---

## 📝 Column Descriptions

### Technical Indicators Explained

**Trend Indicators:**
- `SMA20/50/200` - Simple Moving Average (20/50/200 periods)
- `EMA12/26` - Exponential Moving Average (12/26 periods)
- `MACD` - Moving Average Convergence Divergence
- `ADX` - Average Directional Index (trend strength)

**Momentum Indicators:**
- `RSI` - Relative Strength Index (0-100)
- `Stochastic K/D` - Stochastic Oscillator (0-100)
- `CCI` - Commodity Channel Index
- `Williams %R` - Williams Percent Range (-100 to 0)
- `ROC` - Rate of Change

**Volatility Indicators:**
- `BB Upper/Middle/Lower` - Bollinger Bands
- `ATR` - Average True Range

**Volume Indicators:**
- `OBV` - On-Balance Volume
- `VWAP` - Volume Weighted Average Price
- `Force Index` - Force Index
- `AD Line` - Accumulation/Distribution Line

---

## 🎯 Quick Analysis Examples

### Example 1: Find Recent High RSI
Open `prices_with_symbols.csv` and:
1. Sort by `timestamp` (descending) to get latest data
2. Sort by `rsi` (descending) to find overbought stocks
3. Look for RSI > 70

### Example 2: Identify Trend Direction
1. Compare `close` price with `sma200`
2. If close > sma200: Uptrend
3. If close < sma200: Downtrend

### Example 3: Volume Analysis
1. Sort by `volume` (descending)
2. Find high volume days
3. Check if price moved significantly on those days

---

## 💾 File Sizes

- `stocks.csv`: 198 bytes (1 record)
- `stock_prices.csv`: 4.1 MB (6,810 records with all indicators)
- `prices_with_symbols.csv`: 2.6 MB (6,810 records with key indicators)

---

## 🔐 Data Privacy

These CSV files contain your local database data. Keep them secure and don't share them publicly if they contain sensitive information.

---

## 🆘 Troubleshooting

### File Won't Open
- Try opening with a text editor first
- Check if the file is corrupted
- Re-export the data

### Data Looks Wrong
- Check timestamp format
- Verify column headers
- Ensure proper CSV delimiter (comma)

### Missing Data
- Some technical indicators may be null for early records
- This is normal as indicators need historical data to calculate

---

## 📞 Support

For issues or questions about the data export:
1. Check the export script: `scripts/export-database-to-csv.ts`
2. Review the database schema: `prisma/schema.prisma`
3. Re-run the export: `npm run db:export`

---

**Happy Analyzing! 📊📈**
