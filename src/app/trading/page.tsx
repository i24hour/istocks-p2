'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
    TrendingUp, TrendingDown, Clock, CheckCircle, XCircle,
    Settings, RefreshCw, Trash2, X, ArrowUpRight, ArrowDownRight
} from 'lucide-react'

type TabType = 'orders' | 'positions' | 'holdings'
type TradingMode = 'PAPER' | 'REAL'

interface Order {
    id: string
    symbol: string
    orderType: 'BUY' | 'SELL'
    productType: string
    quantity: number
    entryCondition: any
    entryPrice: number | null
    stopLoss: number | null
    takeProfit: number | null
    status: string
    tradingMode: string
    createdAt: string
}

interface Position {
    id: string
    symbol: string
    productType: string
    side: 'LONG' | 'SHORT'
    quantity: number
    entryPrice: number
    currentPrice: number | null
    unrealizedPnL: number
    unrealizedPct: number
    stopLoss: number | null
    takeProfit: number | null
    status: string
    tradingMode: string
    createdAt: string
}

interface Holding {
    id: string
    symbol: string
    quantity: number
    avgPrice: number
    investedValue: number
    currentPrice: number | null
    currentValue: number | null
    unrealizedPnL: number
    returnPct: number
    dayChange: number
    dayChangePct: number
    tradingMode: string
}

interface HoldingsSummary {
    totalInvested: number
    totalCurrent: number
    totalPnL: number
    totalDayChange: number
    totalReturnPct: number
}

export default function TradingPage() {
    const { data: session, status } = useSession()
    const router = useRouter()

    const [activeTab, setActiveTab] = useState<TabType>('orders')
    const [tradingMode, setTradingMode] = useState<TradingMode>('PAPER')
    const [orders, setOrders] = useState<Order[]>([])
    const [positions, setPositions] = useState<Position[]>([])
    const [holdings, setHoldings] = useState<Holding[]>([])
    const [holdingsSummary, setHoldingsSummary] = useState<HoldingsSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [livePrices, setLivePrices] = useState<Record<string, any>>({})

    // Fetch live prices for P&L calculation (batched — avoid multi‑MB full /prices on Vercel)
    const fetchLivePrices = useCallback(async () => {
        try {
            const symSet = new Set<string>()
            positions.forEach((p) => symSet.add(p.symbol.toUpperCase()))
            holdings.forEach((h) => symSet.add(h.symbol.toUpperCase()))
            const symbols = Array.from(symSet)
            if (symbols.length === 0) {
                setLivePrices({})
                return
            }
            const res = await fetch('/api/live-price', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols }),
                cache: 'no-store',
            })
            if (res.ok) {
                const data = await res.json()
                if (data.success && data.data) {
                    setLivePrices(data.data)
                }
            }
        } catch (e) {
            console.error('Failed to fetch live prices:', e)
        }
    }, [positions, holdings])

    // Fetch data based on active tab
    const fetchData = useCallback(async () => {
        if (!session) return

        setLoading(true)
        try {
            if (activeTab === 'orders') {
                const res = await fetch(`/api/trading/orders?status=PENDING`)
                const data = await res.json()
                if (data.success) setOrders(data.data)
            } else if (activeTab === 'positions') {
                const res = await fetch(`/api/trading/positions?status=OPEN&mode=${tradingMode}`)
                const data = await res.json()
                if (data.success) setPositions(data.data)
            } else if (activeTab === 'holdings') {
                const res = await fetch(`/api/trading/holdings?mode=${tradingMode}`)
                const data = await res.json()
                if (data.success) {
                    setHoldings(data.data)
                    setHoldingsSummary(data.summary)
                }
            }
        } catch (error) {
            console.error('Failed to fetch data:', error)
        } finally {
            setLoading(false)
        }
    }, [session, activeTab, tradingMode])

    // Initial load
    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login')
        }
    }, [status, router])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Live price polling (every 2 seconds)
    useEffect(() => {
        fetchLivePrices()
        const interval = setInterval(fetchLivePrices, 2000)
        return () => clearInterval(interval)
    }, [fetchLivePrices])

    // Update positions with live P&L
    useEffect(() => {
        if (Object.keys(livePrices).length === 0) return

        setPositions(prev => prev.map(pos => {
            const liveData = livePrices[pos.symbol]
            if (liveData?.ltp) {
                const currentPrice = liveData.ltp
                const pnl = pos.side === 'LONG'
                    ? (currentPrice - pos.entryPrice) * pos.quantity
                    : (pos.entryPrice - currentPrice) * pos.quantity
                const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
                return {
                    ...pos,
                    currentPrice,
                    unrealizedPnL: pnl,
                    unrealizedPct: pos.side === 'LONG' ? pnlPct : -pnlPct
                }
            }
            return pos
        }))

        setHoldings(prev => prev.map(h => {
            const liveData = livePrices[h.symbol]
            if (liveData?.ltp) {
                const currentPrice = liveData.ltp
                const currentValue = currentPrice * h.quantity
                const pnl = currentValue - h.investedValue
                const returnPct = (pnl / h.investedValue) * 100
                return {
                    ...h,
                    currentPrice,
                    currentValue,
                    unrealizedPnL: pnl,
                    returnPct,
                    dayChange: liveData.change * h.quantity,
                    dayChangePct: liveData.change_pct
                }
            }
            return h
        }))

        // Update holdings summary
        if (holdings.length > 0) {
            const summary = holdings.reduce((acc, h) => ({
                totalInvested: acc.totalInvested + h.investedValue,
                totalCurrent: acc.totalCurrent + (h.currentValue || h.investedValue),
                totalPnL: acc.totalPnL + h.unrealizedPnL,
                totalDayChange: acc.totalDayChange + h.dayChange,
                totalReturnPct: 0
            }), { totalInvested: 0, totalCurrent: 0, totalPnL: 0, totalDayChange: 0, totalReturnPct: 0 })

            summary.totalReturnPct = summary.totalInvested > 0
                ? ((summary.totalCurrent - summary.totalInvested) / summary.totalInvested) * 100
                : 0

            setHoldingsSummary(summary)
        }
    }, [livePrices])

    const cancelOrder = async (orderId: string) => {
        try {
            await fetch(`/api/trading/orders?id=${orderId}`, { method: 'DELETE' })
            fetchData()
        } catch (e) {
            console.error('Failed to cancel order:', e)
        }
    }

    const closePosition = async (positionId: string) => {
        try {
            await fetch('/api/trading/positions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: positionId, close: true })
            })
            fetchData()
        } catch (e) {
            console.error('Failed to close position:', e)
        }
    }

    if (status === 'loading') {
        return (
            <div className="min-h-screen bg-dark-300 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-emerald-500"></div>
            </div>
        )
    }

    const tabs = [
        { id: 'orders', label: 'Orders', count: orders.length },
        { id: 'positions', label: 'Positions', count: positions.length },
        { id: 'holdings', label: 'Holdings', count: holdings.length }
    ]

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300">
            <main className="max-w-7xl mx-auto px-4 py-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl md:text-3xl font-bold text-white">Trading Dashboard</h1>

                    <div className="flex items-center gap-4">
                        {/* Trading Mode Toggle */}
                        <div className="flex items-center bg-dark-400 rounded-xl p-1">
                            <button
                                onClick={() => setTradingMode('PAPER')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tradingMode === 'PAPER'
                                        ? 'bg-yellow-500/20 text-yellow-400'
                                        : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                📝 Paper
                            </button>
                            <button
                                onClick={() => setTradingMode('REAL')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tradingMode === 'REAL'
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                💰 Real
                            </button>
                        </div>

                        <button
                            onClick={() => router.push('/trading/settings')}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <Settings className="w-5 h-5" />
                        </button>

                        <button
                            onClick={fetchData}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <RefreshCw className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Holdings Summary (only for holdings tab) */}
                {activeTab === 'holdings' && holdingsSummary && (
                    <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 mb-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <p className="text-sm text-gray-400">Current Value</p>
                                <p className="text-2xl font-bold text-white">₹{holdingsSummary.totalCurrent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Invested Value</p>
                                <p className="text-lg text-gray-300">₹{holdingsSummary.totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">1D Returns</p>
                                <p className={`text-lg font-semibold ${holdingsSummary.totalDayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {holdingsSummary.totalDayChange >= 0 ? '+' : ''}₹{holdingsSummary.totalDayChange.toFixed(2)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Total Returns</p>
                                <p className={`text-lg font-semibold ${holdingsSummary.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {holdingsSummary.totalPnL >= 0 ? '+' : ''}₹{holdingsSummary.totalPnL.toFixed(2)} ({holdingsSummary.totalReturnPct.toFixed(2)}%)
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as TabType)}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === tab.id
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-dark-400/50 text-gray-400 hover:text-white border border-white/5'
                                }`}
                        >
                            {tab.label}
                            {tab.count > 0 && (
                                <span className="ml-2 px-2 py-0.5 text-xs bg-white/10 rounded-full">{tab.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500"></div>
                        </div>
                    ) : (
                        <>
                            {/* Orders Tab */}
                            {activeTab === 'orders' && (
                                <div className="overflow-x-auto">
                                    {orders.length === 0 ? (
                                        <div className="text-center py-20 text-gray-400">
                                            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>No pending orders</p>
                                            <p className="text-sm mt-2">Create orders from the AI Chat</p>
                                        </div>
                                    ) : (
                                        <table className="w-full">
                                            <thead className="bg-dark-400/50">
                                                <tr>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Symbol</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Type</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Qty</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Condition</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">SL / TP</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Status</th>
                                                    <th className="text-right px-6 py-4 text-sm text-gray-400 font-medium">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {orders.map(order => (
                                                    <tr key={order.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <span className="font-semibold text-white">{order.symbol}</span>
                                                            <span className="ml-2 text-xs text-gray-500">{order.productType}</span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${order.orderType === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                                                                }`}>
                                                                {order.orderType}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-white">{order.quantity}</td>
                                                        <td className="px-6 py-4 text-gray-300 text-sm">
                                                            {order.entryCondition ? (
                                                                <span>{order.entryCondition.indicator} {order.entryCondition.operator} {order.entryCondition.value}</span>
                                                            ) : order.entryPrice ? (
                                                                <span>@ ₹{order.entryPrice}</span>
                                                            ) : (
                                                                <span className="text-gray-500">Market</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 text-sm">
                                                            {order.stopLoss && <span className="text-red-400">SL: ₹{order.stopLoss}</span>}
                                                            {order.stopLoss && order.takeProfit && <span className="text-gray-500"> / </span>}
                                                            {order.takeProfit && <span className="text-emerald-400">TP: ₹{order.takeProfit}</span>}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="flex items-center gap-1 text-yellow-400">
                                                                <Clock className="w-4 h-4" />
                                                                {order.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => cancelOrder(order.id)}
                                                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}

                            {/* Positions Tab */}
                            {activeTab === 'positions' && (
                                <div className="overflow-x-auto">
                                    {positions.length === 0 ? (
                                        <div className="text-center py-20 text-gray-400">
                                            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>No open positions</p>
                                        </div>
                                    ) : (
                                        <table className="w-full">
                                            <thead className="bg-dark-400/50">
                                                <tr>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Symbol</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Side</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Qty</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Entry</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">LTP</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">P&L</th>
                                                    <th className="text-right px-6 py-4 text-sm text-gray-400 font-medium">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {positions.map(pos => (
                                                    <tr key={pos.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <span className="font-semibold text-white">{pos.symbol}</span>
                                                            <span className="ml-2 text-xs text-gray-500">{pos.productType}</span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`flex items-center gap-1 ${pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {pos.side === 'LONG' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                                                {pos.side}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-white">{pos.quantity}</td>
                                                        <td className="px-6 py-4 text-white">₹{pos.entryPrice.toFixed(2)}</td>
                                                        <td className="px-6 py-4 text-white">
                                                            {pos.currentPrice ? `₹${pos.currentPrice.toFixed(2)}` : '--'}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className={pos.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                                <span className="font-semibold">
                                                                    {pos.unrealizedPnL >= 0 ? '+' : ''}₹{pos.unrealizedPnL.toFixed(2)}
                                                                </span>
                                                                <span className="text-sm ml-1">
                                                                    ({pos.unrealizedPct >= 0 ? '+' : ''}{pos.unrealizedPct.toFixed(2)}%)
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => closePosition(pos.id)}
                                                                className="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-sm font-medium transition-colors"
                                                            >
                                                                Exit
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}

                            {/* Holdings Tab */}
                            {activeTab === 'holdings' && (
                                <div className="overflow-x-auto">
                                    {holdings.length === 0 ? (
                                        <div className="text-center py-20 text-gray-400">
                                            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>No holdings yet</p>
                                        </div>
                                    ) : (
                                        <table className="w-full">
                                            <thead className="bg-dark-400/50">
                                                <tr>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Company</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Market Price</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Returns (%)</th>
                                                    <th className="text-left px-6 py-4 text-sm text-gray-400 font-medium">Current</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {holdings.map(h => (
                                                    <tr key={h.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div>
                                                                <span className="font-semibold text-white">{h.symbol}</span>
                                                                <p className="text-xs text-gray-500">{h.quantity} shares • Avg. ₹{h.avgPrice.toFixed(2)}</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="text-white font-medium">₹{(h.currentPrice || h.avgPrice).toFixed(2)}</div>
                                                            <div className={`text-xs ${h.dayChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {h.dayChangePct >= 0 ? '+' : ''}{h.dayChangePct.toFixed(2)}%
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className={h.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                                {h.unrealizedPnL >= 0 ? '+' : ''}₹{h.unrealizedPnL.toFixed(2)}
                                                            </div>
                                                            <div className={`text-xs ${h.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(2)}%
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="text-white font-medium">₹{(h.currentValue || h.investedValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                                                            <div className="text-xs text-gray-500">₹{h.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    )
}
