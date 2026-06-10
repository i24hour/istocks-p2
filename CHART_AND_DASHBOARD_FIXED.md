# 📊 Chart Timeframes & Dashboard Stats - FIXED

## 🎯 Issues Fixed

### 1. **Chart Timeframe Display**

**Problem**: All timeframes (1D, 1W, 1M, 3M, 6M, 1Y) were showing the same monthly data.

**Solution**:

- Updated API to properly filter data based on selected timeframe
- Each timeframe now shows the correct date range from the **latest available date** in the database
- Uses relative dates from latest data, not from current system date

**Timeframe Mappings:**
| Button | Shows | Date Range |
|--------|-------|------------|
| 1D | Last trading day only | Today's data (9:15 AM - 3:30 PM) |
| 1W | Last 7 days | 7 days back from latest date |
| 1M | Last 30 days | 30 days back from latest date |
| 3M | Last 90 days | 90 days back from latest date |
| 6M | Last 180 days | 180 days back from latest date |
| 1Y | Last 365 days | 365 days back from latest date |

### 2. **X-Axis Time Labels**

**Problem**: All timeframes showed "Month Day" format (e.g., "Nov 18").

**Solution**: Dynamic formatting based on timeframe:

| Timeframe | X-Axis Format  | Example                   |
| --------- | -------------- | ------------------------- |
| 1D        | Time (24-hour) | "09:30", "10:15", "14:30" |
| 1W        | Day + Date     | "Mon 18", "Tue 19"        |
| 1M, 3M    | Date + Month   | "18 Nov", "19 Nov"        |
| 6M, 1Y    | Month + Year   | "Nov 2025", "Dec 2025"    |

### 3. **Dashboard OHLC Stats**

**Problem**: Dashboard showed hardcoded mock data (Open: 245.2, High: 248.5, etc.).

**Solution**:

- API now calculates real OHLC data from the **latest trading day**
- Fetches all 1-minute candles for the latest day
- Calculates:
  - **Open**: First candle's open price
  - **High**: Maximum high across all candles
  - **Low**: Minimum low across all candles
  - **Close**: Last candle's close price
  - **Prev. Close**: Previous day's last close price
  - **Change**: Current close - Previous close
  - **Change %**: ((Change / Prev Close) × 100)

### 4. **Tooltip Improvements**

**Problem**: Tooltip only showed abbreviated time/date.

**Solution**:

- Hovering on chart now shows **full date and time** (e.g., "21/11/2025, 15:29:00")
- Price formatted with ₹ symbol and 2 decimal places

## 🔧 Technical Changes

### 1. API Route: `/api/stocks/[symbol]/data/route.ts`

**Key Improvements:**

#### A. Latest Date Detection

```typescript
// Get the latest timestamp to determine "today"
const latestRecord = await prisma.stockPrice.findFirst({
  where: { stockId: stock.id },
  orderBy: { timestamp: "desc" },
});

const latestDate = new Date(latestRecord.timestamp);
```

#### B. Proper Date Filtering

```typescript
// Example for 1D
case '1d':
  // Show only the latest trading day
  startDate.setHours(0, 0, 0, 0)
  break

// Fetch data within range
const priceData = await prisma.stockPrice.findMany({
  where: {
    stockId: stock.id,
    timestamp: {
      gte: startDate,
      lte: latestDate,
    },
  },
  orderBy: { timestamp: 'asc' },
})
```

#### C. Latest Day Stats Calculation

```typescript
// Get all candles for the latest day
const latestDayStart = new Date(latestDate);
latestDayStart.setHours(0, 0, 0, 0);

const latestDayData = await prisma.stockPrice.findMany({
  where: {
    stockId: stock.id,
    timestamp: {
      gte: latestDayStart,
      lte: latestDate,
    },
  },
  orderBy: { timestamp: "asc" },
});

// Calculate OHLC
const open = latestDayData[0].open;
const close = latestDayData[latestDayData.length - 1].close;
const high = Math.max(...latestDayData.map((d) => d.high));
const low = Math.min(...latestDayData.map((d) => d.low));
```

### 2. Frontend: `/src/app/stock/[symbol]/page.tsx`

**Changed from mock data to real API:**

```typescript
const fetchStockData = async () => {
  const response = await fetch(`/api/stocks/${symbol}/data?timeframe=1d`);
  const result = await response.json();

  if (result.success && result.data.latestDayStats) {
    const stats = result.data.latestDayStats;

    setStockData({
      symbol: stockInfo.symbol,
      name: stockInfo.name,
      price: stats.close.toFixed(2),
      change: stats.change,
      changePercent: stats.changePercent,
      high: stats.high.toFixed(2),
      low: stats.low.toFixed(2),
      open: stats.open.toFixed(2),
      prevClose: stats.prevClose.toFixed(2),
      volume: (stats.volume / 1000000).toFixed(1) + "M",
    });
  }
};
```

### 3. Chart Component: `/src/components/StockChart.tsx`

**Dynamic Time Formatting:**

```typescript
// Different formatting based on timeframe
if (timeframe === "1d") {
  // For 1D: Show time (e.g., "10:30")
  timeLabel = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
} else if (timeframe === "1w") {
  // For 1W: Show day and date (e.g., "Mon 18")
  timeLabel = date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
  });
} else if (timeframe === "1m" || timeframe === "3m") {
  // For 1M/3M: Show date (e.g., "18 Nov")
  timeLabel = date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
} else {
  // For 6M/1Y: Show month and year (e.g., "Nov 2025")
  timeLabel = date.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}
```

## 📈 Expected Behavior

### Scenario: Latest data is Nov 21, 2025 at 3:29 PM

| Timeframe | Data Shown                                               |
| --------- | -------------------------------------------------------- |
| **1D**    | Nov 21: 9:15 AM - 3:29 PM (today's full trading session) |
| **1W**    | Nov 14 - Nov 21 (last 7 days)                            |
| **1M**    | Oct 22 - Nov 21 (last 30 days)                           |
| **3M**    | Aug 23 - Nov 21 (last 90 days)                           |
| **6M**    | May 24 - Nov 21 (last 180 days)                          |
| **1Y**    | Nov 21, 2024 - Nov 21, 2025 (last 365 days)              |

### Dashboard Stats (Always shows latest day):

- **Price**: ₹244.61 (last close of Nov 21)
- **Open**: ₹244.42 (first candle of Nov 21)
- **High**: ₹244.80 (highest during Nov 21)
- **Low**: ₹244.20 (lowest during Nov 21)
- **Prev. Close**: From Nov 20's last candle
- **Change**: Calculated from prev close to current close

## 🎨 Visual Improvements

### Chart Appearance

- **1D Chart**: Shows intraday movement with time labels every few minutes
- **Weekly/Monthly Charts**: Shows daily/weekly patterns clearly
- **Yearly Charts**: Shows long-term trends with monthly labels

### Tooltip

- **Before**: "Nov 18" → ₹243.89
- **After**: "21/11/2025, 15:29:00" → ₹244.61

## 🧪 Testing

### Test 1D Chart:

```bash
# Visit: http://localhost:3001/stock/WIPRO
# Click: 1D button
# Expected: Shows today's trading session (9:15 AM - 3:29 PM)
# X-axis: "09:15", "10:00", "11:30", etc.
```

### Test 1W Chart:

```bash
# Click: 1W button
# Expected: Shows last 7 days
# X-axis: "Fri 15", "Mon 18", "Tue 19", etc.
```

### Test Dashboard Stats:

```bash
# Open stock page
# Check: Open, High, Low, Close values match latest day's data
# Verify: Change % is calculated correctly
```

## 📊 Data Flow

```
User clicks timeframe button (1D, 1W, etc.)
           ↓
StockChart component updates state
           ↓
Fetches: /api/stocks/WIPRO/data?timeframe=1d
           ↓
API queries database:
  1. Get latest timestamp
  2. Calculate date range (startDate to latestDate)
  3. Fetch price data in range
  4. Calculate latest day's OHLC stats
           ↓
Returns: { priceData, latestDayStats }
           ↓
Frontend:
  - Updates chart with filtered data
  - Formats X-axis labels based on timeframe
  - Shows proper tooltip with full date/time
  - Updates dashboard with latest day's OHLC
```

## 🚀 Performance

- **Optimized queries**: Only fetches data for requested timeframe
- **No client-side filtering**: All filtering done in database
- **Indexed timestamps**: Fast queries on `timestamp` field
- **Minimal data transfer**:
  - 1D: ~375 records (1-min candles for 6.25 hours)
  - 1W: ~2,625 records (7 days × 375)
  - 1M: ~7,500 records (20 trading days × 375)
  - 1Y: ~90,000 records (240 trading days × 375)

## ✅ Verification Checklist

- [x] 1D shows only latest trading day
- [x] 1W shows last 7 days from latest date
- [x] 1M shows last 30 days from latest date
- [x] Each timeframe has appropriate X-axis labels
- [x] Dashboard OHLC fetches real data
- [x] Change % calculated correctly
- [x] Tooltip shows full date and time
- [x] Price formatted with ₹ symbol
- [x] No hardcoded mock data

## 🎯 Like Groww Behavior

The implementation now matches Groww's behavior:

1. **Dashboard always shows latest day** ✅
2. **1D shows intraday chart** ✅
3. **1W/1M/etc. show historical data** ✅
4. **Auto-updates when new data arrives** ✅
5. **Proper date formatting for each timeframe** ✅
6. **Real OHLC calculations** ✅

---

**Status**: ✅ All Fixed  
**Last Updated**: Nov 22, 2025  
**Server**: Running on http://localhost:3001
