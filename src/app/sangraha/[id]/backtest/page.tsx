'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
    TrendingUp, ArrowLeft, Play, Calendar, Loader2,
    BarChart3, TrendingDown, AlertCircle
} from 'lucide-react'
import Link from 'next/link'

interface BacktestResult {
    id: string
    totalTrades: number
    winningTrades: number
    losingTrades: number
    winRate: number
    totalPnL: number
    maxDrawdown: number
    avgTradeReturn: number | null
    sharpeRatio: number | null
    status: string
    tradeLog: any[]
    equityCurve: { timestamp: string; equity: number }[]
}

export default function BacktestPage() {
    const params = useParams()
    const router = useRouter()
    const { data: session } = useSession()
    const id = params.id as string

    const [strategy, setStrategy] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [running, setRunning] = useState(false)
    const [result, setResult] = useState<BacktestResult | null>(null)
    const [error, setError] = useState('')

    // Form state
    const [stockSymbol, setStockSymbol] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')

    useEffect(() => {
        fetchStrategy()
        // Set default dates
        const end = new Date()
        const start = new Date()
        start.setMonth(start.getMonth() - 3) // Default to 3 months
        setEndDate(end.toISOString().split('T')[0])
        setStartDate(start.toISOString().split('T')[0])
    }, [id])

    const fetchStrategy = async () => {
        try {
            const response = await fetch(`/api/sangraha/${id}`)
            const data = await response.json()

            if (data.success) {
                setStrategy(data.data)
                if (data.data.stockSymbol) {
                    setStockSymbol(data.data.stockSymbol)
                }
            } else {
                router.push('/sangraha')
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const runBacktest = async () => {
        if (!session) {
            router.push('/login')
            return
        }

        if (!stockSymbol || !startDate || !endDate) {
            setError('Please fill all fields')
            return
        }

        setRunning(true)
        setError('')
        setResult(null)

        try {
            const response = await fetch(`/api/sangraha/${id}/backtest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stockSymbol, startDate, endDate })
            })

            const data = await response.json()

            if (data.success) {
                setResult(data.data)
            } else {
                setError(data.error || 'Backtest failed')
            }
        } catch (err) {
            setError('Failed to run backtest')
        } finally {
            setRunning(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24">
            <main className="max-w-4xl mx-auto px-4 pb-8">
                <nav className="flex items-center gap-3 mb-6">
                    <Link
                        href={`/sangraha/${id}`}
                        className="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to strategy
                    </Link>
                </nav>
                <div className="mb-6">
                    <h1 className="text-xl font-bold text-white">Run Backtest</h1>
                    <p className="text-sm text-gray-400 mt-0.5">{strategy?.name}</p>
                </div>
                {/* Backtest Form */}
                <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 mb-6">
                    <h2 className="text-lg font-semibold text-white mb-4">Backtest Parameters</h2>

                    <div className="grid md:grid-cols-3 gap-4 mb-6">
                        <div>
                            <label className="block text-sm text-gray-400 mb-2">Stock Symbol</label>
                            <input
                                type="text"
                                value={stockSymbol}
                                onChange={(e) => setStockSymbol(e.target.value.toUpperCase())}
                                placeholder="e.g., NIFTY"
                                className="w-full px-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-2">Start Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full px-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-2">End Date</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full px-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    <button
                        onClick={runBacktest}
                        disabled={running}
                        className="w-full py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {running ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Running Backtest...
                            </>
                        ) : (
                            <>
                                <Play className="w-5 h-5" />
                                Run Backtest
                            </>
                        )}
                    </button>
                </div>

                {/* Results */}
                {result && (
                    <div className="space-y-6">
                        {/* Summary Cards */}
                        <div className="grid md:grid-cols-4 gap-4">
                            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
                                <div className="text-sm text-gray-400 mb-1">Total Trades</div>
                                <div className="text-2xl font-bold text-white">{result.totalTrades}</div>
                            </div>

                            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
                                <div className="text-sm text-gray-400 mb-1">Win Rate</div>
                                <div className={`text-2xl font-bold ${result.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {result.winRate.toFixed(1)}%
                                </div>
                                <div className="text-xs text-gray-500">
                                    {result.winningTrades}W / {result.losingTrades}L
                                </div>
                            </div>

                            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
                                <div className="text-sm text-gray-400 mb-1">Total P&L</div>
                                <div className={`text-2xl font-bold flex items-center gap-1 ${result.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {result.totalPnL >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                                    ₹{Math.abs(result.totalPnL).toFixed(0)}
                                </div>
                            </div>

                            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
                                <div className="text-sm text-gray-400 mb-1">Max Drawdown</div>
                                <div className="text-2xl font-bold text-red-400">
                                    -{result.maxDrawdown.toFixed(1)}%
                                </div>
                            </div>
                        </div>

                        {/* Additional Metrics */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
                            <h3 className="text-lg font-semibold text-white mb-4">Performance Metrics</h3>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="flex justify-between items-center p-3 bg-dark-400/30 rounded-xl">
                                    <span className="text-gray-400">Average Trade Return</span>
                                    <span className={`font-semibold ${(result.avgTradeReturn || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        ₹{result.avgTradeReturn?.toFixed(2) || 'N/A'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-dark-400/30 rounded-xl">
                                    <span className="text-gray-400">Sharpe Ratio</span>
                                    <span className={`font-semibold ${(result.sharpeRatio || 0) >= 1 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                        {result.sharpeRatio?.toFixed(2) || 'N/A'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Trade Log */}
                        {result.tradeLog && result.tradeLog.length > 0 && (
                            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
                                <h3 className="text-lg font-semibold text-white mb-4">Trade Log</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-gray-400 border-b border-white/10">
                                                <th className="pb-3">Type</th>
                                                <th className="pb-3">Price</th>
                                                <th className="pb-3">Timestamp</th>
                                                <th className="pb-3">P&L</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.tradeLog.slice(0, 20).map((trade, i) => (
                                                <tr key={i} className="border-b border-white/5">
                                                    <td className="py-3">
                                                        <span className={`px-2 py-0.5 rounded text-xs ${trade.type === 'ENTRY' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                                                            }`}>
                                                            {trade.type}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-white">₹{trade.price.toFixed(2)}</td>
                                                    <td className="py-3 text-gray-400">
                                                        {new Date(trade.timestamp).toLocaleString('en-IN')}
                                                    </td>
                                                    <td className={`py-3 font-medium ${trade.pnl ? (trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500'
                                                        }`}>
                                                        {trade.pnl ? `₹${trade.pnl.toFixed(2)}` : '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {result.tradeLog.length > 20 && (
                                        <p className="text-center text-gray-500 mt-4">
                                            Showing 20 of {result.tradeLog.length} trades
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    )
}
