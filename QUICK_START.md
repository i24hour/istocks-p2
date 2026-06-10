# 🚀 Quick Start Guide - iStocks Platform

## ✅ Current Status: RUNNING

Your iStocks platform is **fully operational** at: **http://localhost:3000**

## 📊 What's Working Right Now

### 1. **Database** ✅
- **31 days** of Wipro stock data loaded
- Date range: Oct 18, 2025 → Nov 17, 2025
- All technical indicators calculated (RSI, MACD, Bollinger Bands, etc.)

### 2. **API Routes** ✅
All backend APIs are live and responding:
- Stock list API
- Historical data API
- AI analysis API (powered by Gemini)

### 3. **Frontend** ✅
- Home page with Wipro stock card
- Stock detail page with real data
- Interactive charts
- AI chatbot (replaces buy/sell box)
- 40+ technical indicators display

## 🎯 Try It Now!

### Step 1: Open the App
Click here or visit: **http://localhost:3000**

### Step 2: View Wipro Stock
Click on the Wipro card on the home page

### Step 3: Explore Features
On the stock detail page, you'll see:
- **Left Side**: Price chart, insights, technical indicators
- **Right Side**: AI Chatbot (instead of buy/sell box)

### Step 4: Chat with AI
Try asking the chatbot:
- "What's the current trend?"
- "Analyze the RSI indicator"
- "What are the support and resistance levels?"
- "Explain the MACD signal"

## 🔑 Your Credentials

### Angel One API
```
API_KEY: YOUR_ANGEL_ONE_API_KEY
CLIENT_ID: YOUR_CLIENT_ID
SECRET_KEY: YOUR_SECRET_KEY
TOTP_TOKEN: YOUR_TOTP_TOKEN
```

### Gemini AI
```
API_KEY: YOUR_GEMINI_API_KEY
```

### Database
```
URL: postgresql://priyanshu@localhost:5432/stock_analysis
Records: 31 days of Wipro data
```

## 💡 Key Features

### 1. **AI Chatbot** (Main Feature)
Located on the right side of the stock page, replacing the traditional buy/sell box. It provides:
- Intelligent analysis using Gemini AI
- Real-time responses based on actual data
- Technical indicator explanations
- Trend analysis

### 2. **Interactive Charts**
- Multiple timeframes (1D, 1W, 1M, 3M, 6M, 1Y)
- Real data from database
- Smooth animations

### 3. **Quick Insights**
- Trend analysis (Bullish/Bearish/Neutral)
- Momentum indicators
- Volatility assessment
- Volume analysis
- Support & Resistance levels

### 4. **40+ Technical Indicators**
All calculated and displayed:
- **Trend**: SMA, EMA, MACD, ADX
- **Momentum**: RSI, Stochastic, CCI, Williams %R
- **Volatility**: Bollinger Bands, ATR
- **Volume**: OBV, VWAP, Force Index, A/D Line

## 🛠️ Useful Commands

```bash
# View database records
psql stock_analysis -c "SELECT COUNT(*) FROM \"StockPrice\";"

# Refresh Wipro data
npm run db:seed

# Restart dev server
npm run dev

# Check if server is running
lsof -i :3000
```

## 📱 Pages Available

1. **Home** - `/`
   - Shows Wipro stock card
   - Click to view details

2. **Stock Detail** - `/stock/WIPRO`
   - Full analysis page
   - Charts, indicators, AI chatbot

## 🎨 UI Highlights

- **Groww-inspired design**: Clean, modern interface
- **Responsive layout**: Works on all screen sizes
- **Real-time data**: All components fetch live data
- **AI-powered**: Intelligent chatbot for analysis

## 🔄 Data Flow

```
User Question → AI Chatbot
                    ↓
            Fetch from Database
                    ↓
        Latest Price + Indicators
                    ↓
            Send to Gemini AI
                    ↓
        Intelligent Analysis
                    ↓
        Display to User
```

## 📈 Sample Data

Latest Wipro data in database:
- **Date**: Nov 17, 2025
- **Price**: ₹239.28
- **RSI**: 36.43 (Slightly oversold)
- **MACD**: Available
- **Bollinger Bands**: Upper ₹251.83, Lower ₹237.79

## 🎯 What Makes This Special

### Traditional Stock Apps:
- Buy/Sell buttons
- Static indicators
- Manual analysis required

### iStocks Platform:
- **AI Chatbot** instead of buy/sell
- Interactive analysis
- Natural language queries
- Intelligent insights

## 🚦 Status Check

Run this to verify everything:
```bash
# Check database
psql stock_analysis -c "SELECT COUNT(*) FROM \"StockPrice\";"

# Check server
curl http://localhost:3000/api/stocks

# Check Wipro data
curl http://localhost:3000/api/stocks/WIPRO/data?timeframe=1m
```

## 🎉 You're All Set!

Everything is configured and running. Just:
1. Open **http://localhost:3000**
2. Click on **Wipro**
3. Start chatting with the **AI assistant**!

---

**Built with**: Next.js 14, TypeScript, PostgreSQL, Prisma, Gemini AI, TailwindCSS

**Status**: ✅ **FULLY OPERATIONAL**
