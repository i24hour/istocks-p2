/**
 * Cascading Price Fetch Strategy
 *
 * Ensures AI always has current prices regardless of market state:
 * Level 1: EC2 WebSocket (real-time, intraday)
 * Level 2: Yahoo batchQuote (latest available quote)
 * Level 3: OHLCV historical close (EOD from recent trading day)
 */

import { fetchOHLCV, batchQuote, fetchLiveMarketQuote } from '@/lib/yahoo-finance'
import { fetchEC2LiveSnapshot } from '@/lib/ec2-helpers'

export interface CascadingPrice {
    symbol: string
    price: number
    source: 'ec2_realtime' | 'yahoo_quote' | 'ohlcv_close' | 'unknown'
    timestamp?: number
    changePercent?: number
}

/**
 * Fetch current price for a single symbol with cascading fallbacks.
 *
 * @returns price with source, or null if all methods fail
 */
export async function fetchCascadingPrice(symbol: string): Promise<CascadingPrice | null> {
    try {
        // Level 1: EC2 WebSocket (real-time)
        const snapshot = await fetchEC2LiveSnapshot(symbol)
        if (snapshot.available && snapshot.ltp && snapshot.ltp > 0) {
            return {
                symbol,
                price: snapshot.ltp,
                source: 'ec2_realtime',
                timestamp: Date.now(),
            }
        }
    } catch {
        // Level 1 failed, continue to Level 2
    }

    try {
        // Level 2: Yahoo Finance Quote (live / latest available)
        const quotes = await batchQuote([symbol])
        if (quotes && quotes.length > 0 && quotes[0] && quotes[0].price > 0) {
            console.log(`[CascadingPrice] L2 Yahoo success: ${symbol} = ₹${quotes[0].price}`)
            return {
                symbol,
                price: quotes[0].price,
                source: 'yahoo_quote',
                changePercent: quotes[0].changePercent,
            }
        }
        console.log(`[CascadingPrice] L2 Yahoo returned invalid data: ${symbol}`, { quotes, length: quotes?.length, firstPrice: quotes?.[0]?.price })
    } catch (err) {
        // Level 2 failed, continue to Level 3
        console.warn(`[CascadingPrice] L2 Yahoo error for ${symbol}:`, err instanceof Error ? err.message : err)
    }

    try {
        // Level 3: OHLCV Historical (last candle close, even if market closed)
        const candles = await fetchOHLCV(symbol, '1mo', '1d')
        if (candles && candles.length > 0) {
            const lastCandle = candles[candles.length - 1]
            if (lastCandle && lastCandle.close > 0) {
                console.log(`[CascadingPrice] L3 OHLCV success: ${symbol} = ₹${lastCandle.close}`)
                return {
                    symbol,
                    price: lastCandle.close,
                    source: 'ohlcv_close',
                    timestamp: lastCandle.timestamp instanceof Date
                        ? lastCandle.timestamp.getTime()
                        : Number(lastCandle.timestamp),
                }
            }
        }
        console.log(`[CascadingPrice] L3 OHLCV returned invalid data: ${symbol}`, { candleCount: candles?.length })
    } catch (err) {
        console.warn(`[CascadingPrice] L3 OHLCV error for ${symbol}:`, err instanceof Error ? err.message : err)
    }

    console.error(`[CascadingPrice] All 3 levels failed for ${symbol}`)
    return null
}

/**
 * Batch fetch current prices for multiple symbols.
 * Returns a Map for O(1) lookup.
 */
export async function fetchCascadingPrices(symbols: string[]): Promise<Map<string, CascadingPrice>> {
    const results = new Map<string, CascadingPrice>()
    const promises = symbols.map(s => fetchCascadingPrice(s))
    const settled = await Promise.allSettled(promises)

    for (let i = 0; i < symbols.length; i++) {
        const result = settled[i]
        if (result.status === 'fulfilled' && result.value) {
            results.set(symbols[i], result.value)
        }
    }

    return results
}

/**
 * Format a CascadingPrice for display/logging.
 */
export function formatCascadingPrice(cp: CascadingPrice): string {
    const sourceLabel = {
        ec2_realtime: '🟢 Realtime',
        yahoo_quote: '🟡 Yahoo Quote',
        ohlcv_close: '🔵 Last Close',
        unknown: '⚪ Unknown',
    }[cp.source]

    const changeStr = cp.changePercent != null
        ? `${cp.changePercent >= 0 ? '+' : ''}${cp.changePercent.toFixed(2)}%`
        : ''

    return `${sourceLabel} | ₹${cp.price.toFixed(2)} ${changeStr}`.trim()
}
