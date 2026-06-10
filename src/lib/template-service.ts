/**
 * Template Service
 * Handles SQL template matching, filling, and learning.
 */

import { prisma } from '@/lib/prisma'

// ============= TYPES =============

export interface Intent {
    type: string        // e.g., "prob_close_above"
    params: Record<string, unknown>  // e.g., { threshold: 1500, timeframe: "1 year" }
    confidence: number  // 0-1
}

export interface TemplateMatch {
    template: {
        id: string
        intentType: string
        sqlTemplate: string
        parameters: unknown
    }
    filledSql: string
}

// ============= BASE TEMPLATES =============
// These are the initial templates that will be seeded into the database

export const BASE_TEMPLATES = [
    {
        intentType: 'prob_close_above',
        patternDesc: 'Probability of closing price above a threshold',
        sampleQuery: 'What is the probability that the stock closes above 1500?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE close > {threshold}) * 100.0 / NULLIF(COUNT(*), 0)
    , 2) as probability
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'threshold', type: 'number', description: 'Price threshold' },
            { name: 'timeframe', type: 'string', description: 'Lookback period (e.g., 1 year)' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'prob_close_below',
        patternDesc: 'Probability of closing price below a threshold',
        sampleQuery: 'What is the probability that the stock closes below 900?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE close < {threshold}) * 100.0 / NULLIF(COUNT(*), 0)
    , 2) as probability
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'threshold', type: 'number', description: 'Price threshold' },
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'prob_open_above',
        patternDesc: 'Probability of opening price above a threshold',
        sampleQuery: 'What is the probability of opening above 1000?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE open > {threshold}) * 100.0 / NULLIF(COUNT(*), 0)
    , 2) as probability
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'threshold', type: 'number', description: 'Price threshold' },
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'avg_volume',
        patternDesc: 'Average trading volume',
        sampleQuery: 'What is the average volume?',
        sqlTemplate: `SELECT ROUND(AVG(volume)::numeric, 0) as avg_volume
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'max_price',
        patternDesc: 'Maximum price in a period',
        sampleQuery: 'What was the highest price?',
        sqlTemplate: `SELECT MAX(high) as max_price, 
    (SELECT timestamp FROM "StockPrice" WHERE "stockId" = '{stockId}' AND high = (SELECT MAX(high) FROM "StockPrice" WHERE "stockId" = '{stockId}' AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}') LIMIT 1) as date
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'min_price',
        patternDesc: 'Minimum price in a period',
        sampleQuery: 'What was the lowest price?',
        sqlTemplate: `SELECT MIN(low) as min_price
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'rsi_overbought',
        patternDesc: 'Percentage of time RSI was above 70 (overbought)',
        sampleQuery: 'How often is RSI above 70?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE rsi > 70) * 100.0 / NULLIF(COUNT(*) FILTER(WHERE rsi IS NOT NULL), 0)
    , 2) as overbought_pct
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'rsi_oversold',
        patternDesc: 'Percentage of time RSI was below 30 (oversold)',
        sampleQuery: 'How often is RSI below 30?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE rsi < 30) * 100.0 / NULLIF(COUNT(*) FILTER(WHERE rsi IS NOT NULL), 0)
    , 2) as oversold_pct
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'support_level',
        patternDesc: 'Recent support level (lowest low)',
        sampleQuery: 'What is the support level?',
        sqlTemplate: `SELECT MIN(low) as support_level
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period (default: 1 month)' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'resistance_level',
        patternDesc: 'Recent resistance level (highest high)',
        sampleQuery: 'What is the resistance level?',
        sqlTemplate: `SELECT MAX(high) as resistance_level
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period (default: 1 month)' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'avg_daily_range',
        patternDesc: 'Average daily price range (high - low)',
        sampleQuery: 'What is the average daily range?',
        sqlTemplate: `SELECT ROUND(AVG(high - low)::numeric, 2) as avg_range
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'price_change_pct',
        patternDesc: 'Price change percentage over a period',
        sampleQuery: 'What is the price change in the last month?',
        sqlTemplate: `WITH first_last AS (
      SELECT 
        (SELECT close FROM "StockPrice" WHERE "stockId" = '{stockId}' AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}' ORDER BY timestamp ASC LIMIT 1) as first_close,
        (SELECT close FROM "StockPrice" WHERE "stockId" = '{stockId}' ORDER BY timestamp DESC LIMIT 1) as last_close
    )
    SELECT ROUND(((last_close - first_close) / NULLIF(first_close, 0)) * 100, 2) as change_pct
    FROM first_last`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'volatility',
        patternDesc: 'Price volatility (standard deviation of returns)',
        sampleQuery: 'How volatile is the stock?',
        sqlTemplate: `SELECT ROUND(STDDEV((close - LAG(close) OVER (ORDER BY timestamp)) / NULLIF(LAG(close) OVER (ORDER BY timestamp), 0) * 100)::numeric, 2) as volatility_pct
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'green_days_pct',
        patternDesc: 'Percentage of days with positive close',
        sampleQuery: 'What percentage of days closed green?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE close > open) * 100.0 / NULLIF(COUNT(*), 0)
    , 2) as green_days_pct
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    },
    {
        intentType: 'supertrend_bullish_pct',
        patternDesc: 'Percentage of time Supertrend was bullish',
        sampleQuery: 'How often is Supertrend bullish?',
        sqlTemplate: `SELECT ROUND(
      COUNT(*) FILTER(WHERE "supertrendDirection" = 1) * 100.0 / NULLIF(COUNT(*) FILTER(WHERE "supertrendDirection" IS NOT NULL), 0)
    , 2) as bullish_pct
    FROM "StockPrice"
    WHERE "stockId" = '{stockId}'
    AND timestamp >= CURRENT_DATE - INTERVAL '{timeframe}'`,
        parameters: [
            { name: 'timeframe', type: 'string', description: 'Lookback period' },
            { name: 'stockId', type: 'string', description: 'Stock UUID' }
        ]
    }
]

// ============= TEMPLATE FUNCTIONS =============

/**
 * Find a template by intent type
 */
export async function findTemplate(intentType: string) {
    return (prisma as any).sqlTemplate.findUnique({
        where: { intentType, isActive: true }
    })
}

/**
 * Fill a template with parameters
 */
export function fillTemplate(sqlTemplate: string, params: Record<string, unknown>): string {
    let filled = sqlTemplate
    for (const [key, value] of Object.entries(params)) {
        const placeholder = `{${key}}`
        filled = filled.replace(new RegExp(placeholder, 'g'), String(value))
    }
    return filled
}

/**
 * Increment template usage count
 */
export async function incrementTemplateUsage(id: string, success: boolean) {
    return (prisma as any).sqlTemplate.update({
        where: { id },
        data: {
            usageCount: { increment: 1 },
            successCount: success ? { increment: 1 } : undefined,
            failureCount: !success ? { increment: 1 } : undefined,
        }
    })
}

/**
 * Save a new template (from a successful dynamic query)
 */
export async function saveAsTemplate(data: {
    intentType: string
    patternDesc: string
    sampleQuery: string
    sqlTemplate: string
    parameters: Array<{ name: string; type: string; description: string }>
}) {
    return (prisma as any).sqlTemplate.create({
        data: {
            intentType: data.intentType,
            patternDesc: data.patternDesc,
            sampleQuery: data.sampleQuery,
            sqlTemplate: data.sqlTemplate,
            parameters: data.parameters as unknown as object,
            isVerified: false,
            isActive: true,
        }
    })
}

/**
 * Get all active templates
 */
export async function getAllTemplates() {
    return (prisma as any).sqlTemplate.findMany({
        where: { isActive: true },
        orderBy: { usageCount: 'desc' }
    })
}

/**
 * Seed base templates into database
 */
export async function seedBaseTemplates() {
    const results = []
    for (const template of BASE_TEMPLATES) {
        try {
            const existing = await (prisma as any).sqlTemplate.findUnique({
                where: { intentType: template.intentType }
            })

            if (!existing) {
                const created = await (prisma as any).sqlTemplate.create({
                    data: {
                        ...template,
                        isVerified: true,
                        isActive: true,
                    }
                })
                results.push({ intentType: template.intentType, status: 'created' })
            } else {
                results.push({ intentType: template.intentType, status: 'exists' })
            }
        } catch (e) {
            results.push({ intentType: template.intentType, status: 'error', error: String(e) })
        }
    }
    return results
}
