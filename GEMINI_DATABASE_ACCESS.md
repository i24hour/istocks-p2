# Gemini AI - Full Database Access

## Overview
Gemini AI now has **full access** to your stock database through function calling. This enables advanced queries, analysis, and insights across all your stock data.

## What Changed?

### Before
- Gemini could only analyze data you explicitly passed to it
- Limited to single stock analysis
- No ability to compare or query across stocks
- Manual data fetching required

### After
- **Full database access** through 9 specialized functions
- Can query any stock, any timeframe
- Compare multiple stocks
- Access all 40+ technical indicators
- Query historical data and insights
- Find top movers and volume patterns

## Available Database Functions

### 1. `getAllStocks`
Get list of all available stocks in the database.

**Example queries:**
- "Show me all available stocks"
- "What stocks do you have data for?"
- "List all stocks in the database"

### 2. `getStockBySymbol`
Get detailed information about a specific stock including recent price data and insights.

**Parameters:**
- `symbol` (required): Stock symbol (e.g., WIPRO, RELIANCE)
- `limit` (optional): Number of price records to fetch (default: 100)

**Example queries:**
- "Tell me about WIPRO"
- "Get detailed data for RELIANCE"
- "Show me WIPRO's recent price history"

### 3. `getLatestPrices`
Get latest price data for a stock.

**Parameters:**
- `symbol` (required): Stock symbol
- `limit` (optional): Number of records (default: 100)

**Example queries:**
- "What's the latest price for WIPRO?"
- "Show me WIPRO's recent prices"
- "Get last 50 price points for RELIANCE"

### 4. `getPricesByDateRange`
Get price data for a specific date range.

**Parameters:**
- `symbol` (required): Stock symbol
- `startDate` (required): Start date (ISO format)
- `endDate` (required): End date (ISO format)

**Example queries:**
- "Show me WIPRO prices from January to March 2024"
- "Get price data for RELIANCE between 2024-01-01 and 2024-03-31"
- "What were the prices last week?"

### 5. `getStockInsights`
Get AI-generated insights for a stock.

**Parameters:**
- `symbol` (required): Stock symbol

**Example queries:**
- "What are the insights for WIPRO?"
- "Show me analysis reports for RELIANCE"
- "Get AI insights for WIPRO"

### 6. `compareStocks`
Compare multiple stocks.

**Parameters:**
- `symbols` (required): Array of stock symbols

**Example queries:**
- "Compare WIPRO and RELIANCE"
- "Which is better: WIPRO, TCS, or INFY?"
- "Show me a comparison of tech stocks"

### 7. `getTopMovers`
Get stocks with highest price changes.

**Parameters:**
- `limit` (optional): Number of stocks to return (default: 10)

**Example queries:**
- "What are today's top movers?"
- "Show me the biggest gainers"
- "Which stocks moved the most?"

### 8. `getVolumeAnalysis`
Get volume analysis for a stock.

**Parameters:**
- `symbol` (required): Stock symbol
- `limit` (optional): Number of records (default: 50)

**Example queries:**
- "Analyze WIPRO's volume"
- "Show me volume patterns for RELIANCE"
- "Is WIPRO's volume increasing?"

### 9. `getTechnicalIndicators`
Get all technical indicators for a stock.

**Parameters:**
- `symbol` (required): Stock symbol

**Example queries:**
- "Show me all technical indicators for WIPRO"
- "What are WIPRO's RSI, MACD, and Bollinger Bands?"
- "Get complete technical analysis for RELIANCE"

## Technical Indicators Available

### Trend Indicators
- SMA (20, 50, 200)
- EMA (12, 26)
- MACD (with Signal and Histogram)
- ADX (Average Directional Index)
- Plus DI / Minus DI

### Momentum Indicators
- RSI (Relative Strength Index)
- Stochastic (K, D)
- CCI (Commodity Channel Index)
- Williams %R
- ROC (Rate of Change)

### Volatility Indicators
- Bollinger Bands (Upper, Middle, Lower)
- ATR (Average True Range)

### Volume Indicators
- OBV (On-Balance Volume)
- VWAP (Volume Weighted Average Price)
- Force Index
- A/D Line (Accumulation/Distribution)

## How to Use

### 1. Access the Database Chat
Navigate to `/database-chat` or click "AI Database" in the navigation menu.

### 2. Ask Natural Language Questions
The AI will automatically:
1. Understand your question
2. Determine which database functions to call
3. Execute the queries
4. Analyze the results
5. Provide a comprehensive answer

### 3. Example Conversations

**Simple Query:**
```
You: "Show me all available stocks"
AI: [Calls getAllStocks()]
AI: "I found 5 stocks in the database: WIPRO, RELIANCE, TCS, INFY, HDFCBANK..."
```

**Complex Analysis:**
```
You: "Compare WIPRO and RELIANCE. Which has better momentum?"
AI: [Calls getStockBySymbol('WIPRO'), getStockBySymbol('RELIANCE'), getTechnicalIndicators('WIPRO'), getTechnicalIndicators('RELIANCE')]
AI: "Based on the analysis:

WIPRO:
- RSI: 65.4 (Bullish momentum)
- MACD: Positive crossover
- Price: ₹244.37

RELIANCE:
- RSI: 58.2 (Neutral momentum)
- MACD: Bearish divergence
- Price: ₹2,450.50

WIPRO shows stronger momentum with RSI above 60 and a positive MACD crossover..."
```

**Multi-Step Query:**
```
You: "Find the top 3 movers and analyze their technical indicators"
AI: [Calls getTopMovers(limit=3), then getTechnicalIndicators() for each]
AI: "Here are today's top 3 movers with technical analysis:

1. WIPRO (+2.5%)
   - RSI: 72 (Overbought)
   - Recommendation: Consider taking profits

2. TCS (+1.8%)
   - RSI: 58 (Neutral)
   - MACD: Bullish
   - Recommendation: Good entry point

3. INFY (-1.2%)
   - RSI: 42 (Oversold)
   - Recommendation: Potential buying opportunity"
```

## API Endpoint

### POST `/api/chat`

**Request Body:**
```json
{
  "message": "Your question here",
  "conversationHistory": [
    {
      "role": "user",
      "content": "Previous message"
    },
    {
      "role": "assistant",
      "content": "Previous response"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "AI response with analysis",
  "functionCalls": [
    {
      "name": "getStockBySymbol",
      "args": { "symbol": "WIPRO" },
      "result": { /* database results */ }
    }
  ],
  "model": "gemini-2.0-flash"
}
```

## Architecture

### Function Calling Flow
1. User sends message to `/api/chat`
2. Gemini receives message with available function declarations
3. Gemini decides which functions to call
4. API executes database queries via Prisma
5. Results sent back to Gemini
6. Gemini analyzes and formats response
7. Response sent to user

### Security
- All database queries go through Prisma ORM (SQL injection protection)
- Function parameters are validated
- Only read operations are allowed (no writes/deletes)
- Rate limiting recommended for production

## Benefits

### For Users
- **Natural Language Queries**: Ask questions in plain English
- **Comprehensive Analysis**: AI can combine multiple data sources
- **Context Awareness**: AI remembers conversation history
- **Smart Insights**: AI can identify patterns across stocks

### For Developers
- **Extensible**: Easy to add new database functions
- **Type-Safe**: Full TypeScript support
- **Maintainable**: Clean separation of concerns
- **Scalable**: Can handle complex multi-step queries

## Future Enhancements

### Planned Features
1. **Write Operations**: Allow AI to save insights and alerts
2. **Real-time Data**: Integration with live market feeds
3. **Portfolio Analysis**: Analyze user portfolios
4. **Predictive Analytics**: ML-based price predictions
5. **Custom Alerts**: AI-generated trading signals
6. **Multi-language Support**: Support for regional languages

### Advanced Queries (Coming Soon)
- "Create a watchlist of stocks with RSI < 30"
- "Alert me when WIPRO crosses ₹250"
- "Backtest a strategy on historical data"
- "Find stocks with golden cross pattern"

## Troubleshooting

### Common Issues

**Issue**: "Function call failed"
- Check database connection
- Verify stock symbol exists
- Check date format (ISO 8601)

**Issue**: "No data available"
- Ensure database is populated
- Run data import scripts
- Check date range

**Issue**: "Slow responses"
- Reduce query limits
- Optimize database indexes
- Consider caching

## Environment Variables

Required in `.env.local`:
```env
DATABASE_URL = os.getenv("DATABASE_URL")
GEMINI_API_KEY="your-gemini-api-key"
```

## Testing

### Test the Integration
1. Navigate to `/database-chat`
2. Try these test queries:
   - "Show me all stocks"
   - "Analyze WIPRO"
   - "What are today's top movers?"
   - "Compare WIPRO and RELIANCE"

### Expected Behavior
- AI should call appropriate functions
- Function calls should be visible in UI
- Responses should include specific data
- Conversation history should be maintained

## Performance

### Optimization Tips
1. Use appropriate limits on data queries
2. Cache frequently accessed data
3. Index database columns used in queries
4. Implement pagination for large datasets
5. Use connection pooling

### Benchmarks
- Simple query: ~500ms
- Complex multi-function query: ~2-3s
- Large dataset analysis: ~5-10s

## Support

For issues or questions:
1. Check the logs in browser console
2. Review function call details in UI
3. Verify database connectivity
4. Check Gemini API quota

## Conclusion

Gemini AI now has comprehensive access to your stock database, enabling sophisticated analysis and insights. The function calling architecture ensures safe, efficient, and intelligent data access while maintaining security and performance.

**Start chatting at: `/database-chat`**
