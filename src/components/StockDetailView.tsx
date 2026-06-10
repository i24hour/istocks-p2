'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Bell, Bookmark, X, MessageSquare } from 'lucide-react'
import Loader from '@/components/Loader'
import StockChart from '@/components/StockChart'
import AIChat from '@/components/AIChat'
import InsightsPanel from '@/components/InsightsPanel'
import TechnicalIndicatorsList from '@/components/TechnicalIndicatorsList'

interface StockDetailViewProps {
    initialData: any
    symbol: string
}

export default function StockDetailView({ initialData, symbol }: StockDetailViewProps) {
    const [data, setData] = useState<any>(initialData)
    const [loading, setLoading] = useState(!initialData)
    const [showChat, setShowChat] = useState(false)
    const [timeframe, setTimeframe] = useState('1d')
    const [livePrice, setLivePrice] = useState<{
        ltp: number; change: number; change_pct: number; close: number; timestamp: string
    } | null>(null)

    // If initialData is missing (error in SSR), fetch client side
    useEffect(() => {
        if (!data) {
            fetchStockData(timeframe)
        }
    }, [])

    // 🔴 LIVE PRICE POLLING - Updates price every 2 seconds from EC2 WebSocket
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null
        const POLLING_INTERVAL = 2000

        const fetchLivePrice = async () => {
            try {
                const res = await fetch(
                    `/api/live-price?symbol=${encodeURIComponent(symbol)}`,
                    { cache: 'no-store' },
                )
                if (!res.ok) return

                const json = await res.json()
                if (json.success && json.data) {
                    const stockData = json.data[symbol]
                    if (stockData && stockData.ltp) {
                        setLivePrice({
                            ltp: stockData.ltp,
                            change: stockData.change ?? 0,
                            change_pct: stockData.change_pct ?? 0,
                            close: stockData.close ?? 0,
                            timestamp: stockData.timestamp ?? new Date().toISOString(),
                        })
                    }
                }
            } catch {
                // Silently fail on polling errors
            }
        }

        fetchLivePrice()
        intervalId = setInterval(fetchLivePrice, POLLING_INTERVAL)

        return () => {
            if (intervalId) clearInterval(intervalId)
        }
    }, [symbol])

    const fetchStockData = async (tf: string) => {
        setLoading(true)
        try {
            const response = await fetch(`/api/stocks/${symbol}/data?timeframe=${tf}`)
            const result = await response.json()

            if (result.success && result.data) {
                setData(result.data)
            }
        } catch (error) {
            console.error('Error fetching stock data:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading || !data?.latestDayStats) {
        // If we have no data at all
        if (!initialData) return (
            <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center">
                <Loader size={64} />
            </div>
        )
    }

    const stockInfo = data.stock || { name: symbol, symbol }
    const stats = data.latestDayStats || {}
    
    // Use live WebSocket data if available, otherwise fallback to DB data
    const displayPrice = livePrice?.ltp ?? stats.close
    const displayChange = livePrice?.change ?? stats.change
    const displayChangePct = livePrice?.change_pct ?? stats.changePercent
    const displayPrevClose = livePrice?.close ?? stats.prevClose
    const isPositive = (displayChange ?? 0) >= 0

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300">

            {/* Mobile AI Chat Overlay */}
            {showChat && (
                <div className="lg:hidden fixed inset-0 z-40 bg-dark-300/95">
                    <div className="h-full overflow-hidden relative">
                        <button
                            onClick={() => setShowChat(false)}
                            className="absolute top-3 right-3 z-50 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 border border-white/10"
                            aria-label="Close chat"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <AIChat symbol={symbol} />
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                    {/* Left Column - Chart and Info */}
                    <div className="lg:col-span-2 space-y-4 md:space-y-6">
                        {/* Stock Header */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-white/10">
                            <div className="flex items-start justify-between mb-3 md:mb-4">
                                <div className="flex items-center gap-3 md:gap-4">
                                    <div className={`w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br ${isPositive ? 'from-emerald-500 to-green-600' : 'from-red-500 to-rose-600'} rounded-2xl flex items-center justify-center shadow-lg`}>
                                        <span className="text-white font-bold text-lg md:text-2xl">{stockInfo.name ? stockInfo.name.charAt(0) : 'S'}</span>
                                    </div>
                                    <div>
                                        <h1 className="text-xl md:text-3xl font-bold text-white">{stockInfo.name}</h1>
                                        <p className="text-sm md:text-base text-gray-400">NSE: {symbol}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="p-2 hover:bg-white/10 rounded-xl border border-white/10 transition-colors">
                                        <Bell className="w-4 h-4 md:w-5 md:h-5 text-gray-400" />
                                    </button>
                                    <button className="p-2 hover:bg-white/10 rounded-xl border border-white/10 transition-colors">
                                        <Bookmark className="w-4 h-4 md:w-5 md:h-5 text-gray-400" />
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-baseline gap-2 md:gap-3">
                                <span className={`text-3xl md:text-4xl font-bold text-white ${livePrice ? 'transition-all duration-300' : ''}`}>
                                    ₹{displayPrice?.toFixed(2)}
                                </span>
                                <div className={`flex items-center gap-1 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {isPositive ? <TrendingUp className="w-4 h-4 md:w-5 md:h-5" /> : <TrendingDown className="w-4 h-4 md:w-5 md:h-5" />}
                                    <span className="text-sm md:text-lg font-semibold">
                                        {displayChange != null && displayChange > 0 ? '+' : ''}{displayChange?.toFixed(2)} ({displayChangePct?.toFixed(2)}%)
                                    </span>
                                    <span className="text-xs md:text-sm text-gray-500 ml-1">1D</span>
                                </div>
                                {livePrice && (
                                    <span className="flex items-center gap-1 text-xs text-emerald-400/70">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        LIVE
                                    </span>
                                )}
                            </div>

                            <div className="mt-4 md:mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 pt-4 border-t border-white/10">
                                <div>
                                    <p className="text-xs md:text-sm text-gray-500">Open</p>
                                    <p className="text-base md:text-lg font-semibold text-white">₹{stats.open}</p>
                                </div>
                                <div>
                                    <p className="text-xs md:text-sm text-gray-500">High</p>
                                    <p className="text-base md:text-lg font-semibold text-emerald-400">₹{stats.high}</p>
                                </div>
                                <div>
                                    <p className="text-xs md:text-sm text-gray-500">Low</p>
                                    <p className="text-base md:text-lg font-semibold text-red-400">₹{stats.low}</p>
                                </div>
                                <div>
                                    <p className="text-xs md:text-sm text-gray-500">Prev. Close</p>
                                    <p className="text-base md:text-lg font-semibold text-white">₹{displayPrevClose}</p>
                                </div>
                            </div>
                        </div>

                        {/* Chart */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-white/10">
                            <StockChart symbol={symbol} />
                        </div>

                        {/* Insights Panel */}
                        <InsightsPanel symbol={symbol} />

                        {/* Technical Indicators */}
                        <TechnicalIndicatorsList symbol={symbol} initialData={data.latestIndicatorData} />
                    </div>

                    {/* Right Column - AI Chatbot (Desktop Only) */}
                    <div className="hidden lg:block lg:col-span-1">
                        <div className="sticky top-24">
                            <AIChat symbol={symbol} />
                        </div>
                    </div>
                </div>
            </main>

            {/* Mobile Floating AI Button */}
            {!showChat && (
                <button
                    onClick={() => setShowChat(true)}
                    className="lg:hidden fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 z-30"
                >
                    <MessageSquare className="w-6 h-6" />
                </button>
            )}
        </div>
    )
}
