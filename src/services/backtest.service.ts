import { prisma } from '@/lib/prisma'

interface Trade {
    type: 'ENTRY' | 'EXIT'
    price: number
    timestamp: Date
    pnl?: number
}

interface BacktestResult {
    totalTrades: number
    winningTrades: number
    losingTrades: number
    winRate: number
    totalPnL: number
    maxDrawdown: number
    avgTradeReturn: number | null
    sharpeRatio: number | null
    tradeLog: Trade[]
    equityCurve: { timestamp: Date; equity: number }[]
}

interface StrategyCondition {
    type: 'price_change' | 'price_level' | 'indicator' | 'probability'
    direction?: 'up' | 'down'
    operator?: '>=' | '<=' | '>' | '<' | '='
    value?: number
    points?: number
    indicator?: string
}

interface StrategyCode {
    conditions: StrategyCondition[]
    entryType?: 'sequence' | 'all_match'
    exitConditions?: StrategyCondition[]
    stopLoss?: number
    takeProfit?: number
}

export class BacktestService {

    async runBacktest(
        strategyCode: StrategyCode,
        stockSymbol: string,
        startDate: Date,
        endDate: Date
    ): Promise<BacktestResult> {

        // Find the stock
        const stock = await prisma.stock.findUnique({
            where: { symbol: stockSymbol.toUpperCase() }
        })

        if (!stock) {
            throw new Error(`Stock ${stockSymbol} not found`)
        }

        // Fetch historical data
        const priceData = await prisma.stockPrice.findMany({
            where: {
                stockId: stock.id,
                timestamp: {
                    gte: startDate,
                    lte: endDate
                }
            },
            orderBy: { timestamp: 'asc' }
        })

        if (priceData.length < 10) {
            throw new Error(`Not enough data points for backtest. Found: ${priceData.length}`)
        }

        // Initialize backtest state
        const trades: Trade[] = []
        const equityCurve: { timestamp: Date; equity: number }[] = []
        let inPosition = false
        let entryPrice = 0
        let equity = 100000 // Starting capital
        let maxEquity = equity
        let maxDrawdown = 0

        // Simple strategy execution
        // For now, we'll implement a basic pattern matching backtest
        for (let i = 1; i < priceData.length; i++) {
            const current = priceData[i]
            const previous = priceData[i - 1]
            const priceChange = current.close - previous.close

            // Check entry conditions
            if (!inPosition) {
                const shouldEnter = this.checkConditions(
                    strategyCode.conditions,
                    current,
                    previous,
                    priceChange
                )

                if (shouldEnter) {
                    inPosition = true
                    entryPrice = current.close
                    trades.push({
                        type: 'ENTRY',
                        price: entryPrice,
                        timestamp: current.timestamp
                    })
                }
            } else {
                // Check exit conditions
                const pnl = current.close - entryPrice
                const pnlPercent = (pnl / entryPrice) * 100

                // Exit conditions: stop loss, take profit, or exit signal
                const stopLoss = strategyCode.stopLoss || 3 // Default 3 points stop loss
                const takeProfit = strategyCode.takeProfit || 5 // Default 5 points take profit

                const shouldExit =
                    pnl <= -stopLoss ||
                    pnl >= takeProfit ||
                    (strategyCode.exitConditions && this.checkConditions(
                        strategyCode.exitConditions,
                        current,
                        previous,
                        priceChange
                    ))

                if (shouldExit) {
                    equity += pnl * 100 // Assuming 100 shares
                    trades.push({
                        type: 'EXIT',
                        price: current.close,
                        timestamp: current.timestamp,
                        pnl
                    })
                    inPosition = false
                    entryPrice = 0
                }
            }

            // Track equity curve
            const unrealizedPnL = inPosition ? (current.close - entryPrice) * 100 : 0
            const currentEquity = equity + unrealizedPnL
            equityCurve.push({
                timestamp: current.timestamp,
                equity: currentEquity
            })

            // Track max drawdown
            if (currentEquity > maxEquity) {
                maxEquity = currentEquity
            }
            const drawdown = ((maxEquity - currentEquity) / maxEquity) * 100
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown
            }
        }

        // Calculate statistics
        const exitTrades = trades.filter(t => t.type === 'EXIT')
        const winningTrades = exitTrades.filter(t => (t.pnl || 0) > 0).length
        const losingTrades = exitTrades.filter(t => (t.pnl || 0) <= 0).length
        const totalTrades = exitTrades.length
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0
        const totalPnL = equity - 100000

        // Calculate average return
        let avgTradeReturn: number | null = null
        if (totalTrades > 0) {
            const totalReturn = exitTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)
            avgTradeReturn = totalReturn / totalTrades
        }

        // Simple Sharpe ratio calculation (annualized)
        let sharpeRatio: number | null = null
        if (exitTrades.length > 1) {
            const returns = exitTrades.map(t => t.pnl || 0)
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
            const stdDev = Math.sqrt(variance)
            if (stdDev > 0) {
                sharpeRatio = (mean / stdDev) * Math.sqrt(252) // Annualized
            }
        }

        return {
            totalTrades,
            winningTrades,
            losingTrades,
            winRate,
            totalPnL,
            maxDrawdown,
            avgTradeReturn,
            sharpeRatio,
            tradeLog: trades,
            equityCurve: equityCurve.filter((_, i) => i % 10 === 0) // Sample every 10th point
        }
    }

    private checkConditions(
        conditions: StrategyCondition[],
        current: any,
        previous: any,
        priceChange: number
    ): boolean {
        for (const condition of conditions) {
            switch (condition.type) {
                case 'price_change':
                    if (condition.direction === 'up' && priceChange < (condition.points || 0)) {
                        return false
                    }
                    if (condition.direction === 'down' && priceChange > -(condition.points || 0)) {
                        return false
                    }
                    break

                case 'indicator':
                    if (condition.indicator === 'rsi') {
                        const rsi = current.rsi
                        if (rsi === null) continue
                        if (condition.operator === '>=' && rsi < (condition.value || 0)) return false
                        if (condition.operator === '<=' && rsi > (condition.value || 0)) return false
                        if (condition.operator === '>' && rsi <= (condition.value || 0)) return false
                        if (condition.operator === '<' && rsi >= (condition.value || 0)) return false
                    }
                    break

                case 'price_level':
                    if (condition.operator === '>=' && current.close < (condition.value || 0)) return false
                    if (condition.operator === '<=' && current.close > (condition.value || 0)) return false
                    break
            }
        }
        return true
    }
}

export const backtestService = new BacktestService()
