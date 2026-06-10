# iStocks - AI-Powered Stock Analysis Platform

A modern stock analysis platform similar to Groww, featuring an **AI chatbot** instead of traditional buy/sell boxes. Built with Next.js 14, TypeScript, and Gemini AI.

## 🌟 Features

- **AI Chatbot**: Interactive AI assistant powered by Google Gemini for intelligent stock analysis
- **Real-time Stock Data**: Live price updates and market information
- **40+ Technical Indicators**: Comprehensive analysis including RSI, MACD, Bollinger Bands, and more
- **Beautiful UI**: Modern, responsive design inspired by Groww
- **Interactive Charts**: Real-time price charts with Recharts
- **Quick Insights**: Pre-calculated market insights and trends

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ with TimescaleDB extension (for production)
- Angel One API credentials (for live data)
- Google Gemini API key

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd istocks-p
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env.local
```

Edit `.env.local` and add your credentials:
```env
DATABASE_URL = os.getenv("DATABASE_URL")
ANGELONE_API_KEY="your_angel_one_api_key"
ANGELONE_CLIENT_ID="your_client_id"
ANGELONE_PASSWORD="your_password"
GEMINI_API_KEY="your_gemini_api_key"
NODE_ENV="development"
TZ="Asia/Kolkata"
```

4. **Set up the database**
```bash
npx prisma generate
npx prisma db push
```

5. **Run the development server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## 📁 Project Structure

```
istocks-p/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout
│   │   ├── page.tsx                # Home page
│   │   ├── stock/[symbol]/
│   │   │   └── page.tsx            # Stock detail page
│   │   └── globals.css             # Global styles
│   ├── components/
│   │   ├── AIChat.tsx              # AI Chatbot component ⭐
│   │   ├── StockChart.tsx          # Price chart
│   │   ├── InsightsPanel.tsx       # Quick insights
│   │   └── TechnicalIndicatorsList.tsx
│   └── prisma/
│       └── schema.prisma           # Database schema
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

## 🤖 AI Chatbot Features

The AI chatbot replaces traditional buy/sell boxes and provides:

- **Intelligent Analysis**: Ask questions about trends, patterns, and indicators
- **Natural Language**: Chat naturally about stock performance
- **Real-time Insights**: Get instant analysis based on current data
- **40+ Indicators**: Access to comprehensive technical analysis
- **Contextual Responses**: AI understands your queries and provides relevant answers

### Example Questions:
- "What's the current trend based on technical indicators?"
- "Analyze RSI and MACD signals"
- "Find support and resistance levels"
- "Check volume patterns"

## 🛠️ Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Icons**: Lucide React
- **AI**: Google Gemini API
- **Database**: PostgreSQL with Prisma ORM
- **Technical Indicators**: technicalindicators library

## 📊 Available Technical Indicators

### Trend Indicators
- SMA (20, 50, 200)
- EMA (12, 26)
- MACD
- ADX

### Momentum Indicators
- RSI
- Stochastic Oscillator
- CCI
- Williams %R
- ROC

### Volatility Indicators
- Bollinger Bands
- ATR

### Volume Indicators
- OBV
- VWAP
- Force Index
- A/D Line

## 🎨 UI Highlights

- **Groww-inspired Design**: Clean, modern interface
- **Responsive Layout**: Works on all devices
- **Dark Mode Ready**: Easy to implement
- **Smooth Animations**: Polished user experience
- **Chatbot Interface**: Replaces traditional buy/sell box

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For support, email priyanshu@istocks.codes or open an issue.
