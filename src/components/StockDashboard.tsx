'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { TrendingUp, TrendingDown } from 'lucide-react'
import Loader from '@/components/Loader'
import StockLogo from '@/components/StockLogo'

interface StockData {
    symbol: string
    name: string
    exchange: string
    latestPrice: number | null
    change: number | null
    changePercent: number | null
    volume: number | null
}

interface StockDashboardProps {
    initialStocks: StockData[]
}

export default function StockDashboard({ initialStocks }: StockDashboardProps) {
    const router = useRouter()
    const [stocks, setStocks] = useState<StockData[]>(initialStocks)
    const [loading, setLoading] = useState(false) // Initially false as we have SSR data
    const [error, setError] = useState<string | null>(null)
    const stocksRef = useRef(stocks)
    useEffect(() => {
        stocksRef.current = stocks
    }, [stocks])

    // Polling for live prices
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        const POLLING_INTERVAL = 2000;

        if (stocks.length > 0) {
            const fetchLivePrices = async () => {
                try {
                    const syms = stocksRef.current.map((s) => s.symbol.toUpperCase())
                    if (syms.length === 0) return

                    const res = await fetch('/api/live-price', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbols: syms }),
                        cache: 'no-store',
                    })

                    if (!res.ok) {
                        return;
                    }
                    const json = await res.json();

                    if (json.success && json.data) {
                        setStocks(prevStocks => prevStocks.map(stock => {
                            const liveData = json.data[stock.symbol];
                            if (liveData && liveData.ltp) {
                                return {
                                    ...stock,
                                    latestPrice: liveData.ltp,
                                    change: liveData.change !== undefined ? liveData.change : stock.change,
                                    changePercent: liveData.change_pct !== undefined ? liveData.change_pct : stock.changePercent
                                };
                            }
                            return stock;
                        }));
                    }
                } catch (e) {
                    // Silently fail on polling errors
                }
            };

            // Fetch immediately on mount, then poll every 2s
            fetchLivePrices();
            intervalId = setInterval(fetchLivePrices, POLLING_INTERVAL);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, []); // Only run once on mount

    const getGradientColors = (symbol: string, change: number | null) => {
        if (symbol === 'NIFTY') return 'from-blue-600 to-indigo-600'
        if (change === null) return 'from-gray-600 to-gray-700'
        if (change >= 0) return 'from-emerald-400 to-emerald-500'
        return 'from-red-500 to-rose-600'
    }

    return (
        <>
            <div className="text-center mb-8 md:mb-12">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-4" style={{ color: 'var(--text-primary)' }}>
                    AI-Powered <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-400 bg-clip-text text-transparent">Stock Analysis</span>
                </h1>
                <p className="text-base md:text-xl" style={{ color: 'var(--text-secondary)' }}>
                    Get intelligent insights with our AI chatbot
                </p>
            </div>

            {/* Stock Cards */}
            <div className="mb-12 md:mb-16">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader size={56} />
                    </div>
                ) : error ? (
                    <div className="text-center py-8 text-red-400 font-medium bg-red-500/10 rounded-xl border border-red-500/20">
                        {error}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                        {stocks.map((stock) => (
                            <div
                                key={stock.symbol}
                                onClick={() => router.push(`/stock/${stock.symbol}`)}
                                className="group backdrop-blur-xl rounded-2xl hover:shadow-xl transition-all cursor-pointer p-4 md:p-6 active:scale-[0.98]"
                                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                            >
                                <div className="flex items-center gap-3 mb-3 md:mb-4">
                                    <StockLogo
                                        symbol={stock.symbol}
                                        name={stock.name}
                                        exchange={stock.exchange}
                                        fallbackGradientClassName={getGradientColors(stock.symbol, stock.change)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-base md:text-lg font-bold group-hover:text-emerald-400 transition-colors truncate" style={{ color: 'var(--text-primary)' }}>{stock.name}</h2>
                                        <p className="text-xs md:text-sm" style={{ color: 'var(--text-muted)' }}>{stock.exchange}: {stock.symbol}</p>
                                    </div>
                                </div>

                                {stock.latestPrice !== null ? (
                                    <>
                                        <div className="mb-2">
                                            <div className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>₹{stock.latestPrice.toFixed(2)}</div>
                                            {stock.change !== null && stock.changePercent !== null && (
                                                <div className={`flex items-center gap-1 text-sm ${stock.change < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                                    {stock.change < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                                                    <span className="font-semibold">
                                                        {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)} ({stock.changePercent.toFixed(2)}%)
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {stock.volume && (
                                            <div className="text-xs text-gray-500">
                                                Vol: {(stock.volume / 1000000).toFixed(2)}M
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-sm text-gray-500">Loading...</div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {/* WhatsApp / Support Button (Home Page Only) */}

        </>
    )
}
