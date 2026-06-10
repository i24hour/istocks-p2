import { generateText, jsonSchema } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { fetchOHLCV, computeIndicators, batchQuote } from '@/lib/yahoo-finance'
import { searchGoogle } from '@/lib/googleSearch'

const _bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

export async function runYahooAgent(message: string) {
    try {
        const systemPrompt = `ROLE: You are iStocks AI — a licensed Indian stock market advisor and trader.
You give direct, confident, actionable advice. NO disclaimers. NO "I cannot recommend" phrases.
BANNED (NEVER say): "As an AI", "consult a financial advisor", "informational purposes only", "investment decisions depend on", "personal risk tolerance", "do your own research", "I cannot predict", "I am not a financial advisor".
If you feel like saying any of those → STOP → give the actual answer instead.

── MANDATORY TOOL USE ──────────────────────────────────────────────
You have 2 tools: analyzeStock (prices + technicals) and getMarketMovers (live quotes).
RULE: You MUST call a tool before answering. NEVER answer from your own training knowledge.
RULE: Every price, indicator, and market fact in your answer MUST come from a tool result.
RULE: Your training data is outdated — do NOT use it for prices, stock news, or market conditions.
If data is insufficient after tool calls, say what's missing — do NOT fill gaps from your own knowledge.
────────────────────────────────────────────────────────────────────

You do NOT have a static database. You have tools to fetch real-time and historical data from Yahoo Finance.
Always use your tools to look up the data before answering.

When a user asks about a stock (e.g. "Reliance", "Zomato", "Tata Motors"):
1. Call \`analyzeStock\` to get the technical indicators and recent price trend.
2. If they ask for top gainers/losers or compare stocks, call \`getMarketMovers\`.

Analyze the data returned by the tools and provide a direct, confident, actionable response formatted nicely in Markdown.
- Provide a clear recommendation (Buy/Sell/Hold) based on indicators (RSI, MACD, Moving Averages).
- ALWAYS include Entry, Stop-Loss, and Target using this formula:
  • Entry     = latestPrice
  • Stop-Loss = latestPrice − (atr14 × 1.5). Fallback if atr14 null: latestPrice × 0.97
  • Target    = next SMA above price (sma50 if price < sma50, else sma200).
                Fallback if SMAs null: latestPrice + (atr14 × 3). Final fallback: latestPrice × 1.05
  • R/R       = (target − entry) / (entry − stopLoss)
  • Holding   = estimated days to reach target based on ATR (avg daily move)
                Formula: ceil((target − entry) / (atr14 × 0.5))
                Clamp to 1–90 days. Express as range: e.g. "3-5 days", "1-2 weeks"
  Format: Entry: ₹XXX | Target: ₹XXX | Stop-Loss: ₹XXX | R/R: X.X | Holding: X-X days
  Add one line: "Target = [SMA50/SMA200/ATR-based]; SL = [1.5× ATR / fallback]; Holding = [basis]"
- NEVER say "I am an AI" or "Consult a financial advisor" or "As an AI I cannot predict target prices".
  You ALWAYS give specific levels derived from the technical data. Act as the expert.
- If asked in Hinglish, reply in Hinglish.`;

        const agentTools = {
            analyzeStock: {
                description: 'Fetch technical indicators and latest price trend for a specific Indian stock symbol.',
                inputSchema: jsonSchema<{ symbol: string; range: string }>({
                    type: 'object',
                    properties: {
                        symbol: { type: 'string', description: 'The stock name or NSE symbol (e.g. RELIANCE, ZOMATO). Do not include .NS.' },
                        range: { type: 'string', description: 'Time range: 1mo, 3mo, 6mo, 1y. Default to 3mo if unsure.' }
                    },
                    required: ['symbol', 'range'],
                    additionalProperties: false
                }),
                execute: async ({ symbol, range }: any) => {
                    // Always fetch 1y minimum — SMA200 needs 200+ candles; 3mo only gives ~63.
                    const fetchRange = (!range || range === '1mo' || range === '3mo' || range === '6mo') ? '1y' : range
                    try {
                        const candles = await fetchOHLCV(symbol, fetchRange, '1d')
                        if (candles.length < 5) return { error: `Not enough data for ${symbol}.` }
                        const ind = computeIndicators(candles)
                        return {
                            symbol,
                            latestPrice: ind.latestClose,
                            trend: ind.latestClose && candles[0].close && ind.latestClose > candles[0].close ? 'Bullish' : 'Bearish',
                            rsi: ind.rsi14,
                            macd: ind.macd,
                            macdSignal: ind.macdSignal,
                            sma20: ind.sma20,
                            sma50: ind.sma50,
                            sma200: ind.sma200,
                            bbUpper: ind.bbUpper,
                            bbLower: ind.bbLower,
                            atr14: ind.atr14,
                            dataPoints: ind.candleCount
                        }
                    } catch (err: any) {
                        return { error: `Failed to fetch data for ${symbol}: ${err.message}` }
                    }
                }
            } as any,
            getMarketMovers: {
                description: 'Fetch live price and percentage change for multiple stocks. If the user asks for general market movers, use an empty array or omit symbols to fall back to a default list of Nifty 50 tokens.',
                inputSchema: jsonSchema<{ symbols: string[] }>({
                    type: 'object',
                    properties: {
                        symbols: { type: 'array', items: { type: 'string' }, description: 'NSE symbols array. Pass empty array [] for default Nifty 50 stocks.' }
                    },
                    required: ['symbols'],
                    additionalProperties: false
                }),
                execute: async ({ symbols }: any) => {
                    const list = symbols && symbols.length > 0 ? symbols : ['RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'ITC', 'SBIN', 'BHARTIARTL', 'BAJFINANCE', 'LARSEN', 'KOTAKBANK', 'AXISBANK', 'TATAMOTORS', 'SUNPHARMA', 'NTPC', 'MARUTI', 'ULTRACEMCO', 'TITAN', 'POWERGRID', 'BAJAJFINSV', 'M&M', 'ASIANPAINT', 'HCLTECH', 'TATASTEEL', 'ADANIENT', 'ADANIPORTS', 'NESTLEIND', 'ONGC', 'TECHM', 'WIPRO', 'HINDUNILVR', 'BAJAJ-AUTO', 'GRASIM', 'HINDALCO', 'DIVISLAB', 'CIPLA', 'APOLLOHOSP', 'JSWSTEEL', 'TATACONSUM', 'EICHERMOT', 'BRITANNIA', 'DRREDDY', 'HEROMOTOCO', 'SBILIFE', 'BPCL', 'COALINDIA', 'INDUSINDBK', 'HDFCLIFE']
                    try {
                        const quotes = await batchQuote(list)
                        return quotes.map(q => ({
                            symbol: q.symbol,
                            price: q.price,
                            changePercent: q.changePercent,
                            volume: q.volume
                        }))
                    } catch (err: any) {
                        return { error: `Failed to fetch quotes: ${err.message}` }
                    }
                }
            } as any,
            webSearch: {
                description: 'Search the web for anything: find a stock ticker, check if a company is listed, get latest news, or solve any problem you are stuck on. Use this whenever other tools fail or you need more context.',
                inputSchema: jsonSchema<{ query: string }>({
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Free-form search query, e.g. "Swiggy NSE symbol India stock", "Ola Electric IPO listed exchange", "Reliance Q3 results 2026"' }
                    },
                    required: ['query'],
                    additionalProperties: false
                }),
                execute: async ({ query }: any) => {
                    try {
                        const res = await searchGoogle(query, '', '', 5)
                        if (!res.success || res.results.length === 0) {
                            return { error: res.error || 'No results found.' }
                        }
                        return res.results.map(r => ({
                            title: r.name,
                            snippet: r.snippet,
                            date: r.datePublished ?? null,
                        }))
                    } catch (err: any) {
                        return { error: `Web search failed: ${err.message}` }
                    }
                }
            } as any
        };

        const result = await generateText({
            model: _bedrock(BEDROCK_MODEL),
            system: systemPrompt,
            prompt: message,
            tools: agentTools
        });

        // Manual Tool Loop Fallback for AI SDK versions lacking native maxSteps 
        if (result.toolResults && result.toolResults.length > 0) {
            console.log('🤖 [Yahoo Agent] Tool executed successfully. Generating final summary...');
            const finalResult = await generateText({
                model: _bedrock(BEDROCK_MODEL),
                system: systemPrompt,
                prompt: `User asked: "${message}"\n\nLive market data fetched from tools:\n${JSON.stringify(result.toolResults, null, 2)}\n\n⚠️ DATA RULE: Your answer MUST be based ONLY on the tool data above. Every number, price, and fact must come from these results.\n\nPresent the technical analysis from this data in a super-friendly, conversational way. Give entry/SL/target for each stock using ATR+SMA formula. Be direct — act as a trading buddy sharing live data, not a disclaimer-giving chatbot.`,
            });
            return { success: true, message: finalResult.text, source: 'yahoo-agent' };
        }

        return { success: true, message: result.text, source: 'yahoo-agent' };
    } catch (error: any) {
        console.error('❌ Yahoo Agent Error:', error)
        return { success: false, message: 'Sorry, I encountered an issue while analyzing the market data.', error: error.message }
    }
}
