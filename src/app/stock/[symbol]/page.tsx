'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { TrendingUp, TrendingDown, Bell, Bookmark, X } from 'lucide-react'
import Loader from '@/components/Loader'
import StockChart from '@/components/StockChart'
import AIChat from '@/components/AIChat'
import InsightsPanel from '@/components/InsightsPanel'
import TechnicalIndicatorsList from '@/components/TechnicalIndicatorsList'

export default function StockDetailPage() {
  const params = useParams()
  const symbol = (params.symbol as string).toUpperCase()

  const [stockData, setStockData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showChat, setShowChat] = useState(false)

  // EC2 live data states
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [liveChange, setLiveChange] = useState<number | null>(null)
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null)
  const [liveOHLC, setLiveOHLC] = useState<{
    open: number | null; high: number | null; low: number | null; prevClose: number | null
  } | null>(null)

  // ── 1. Initial DB data load (for chart timeframe, stock name, volume) ──
  useEffect(() => {
    fetchStockData()
  }, [symbol])

  const fetchStockData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/stocks/${symbol}/data?timeframe=1d`)
      const result = await response.json()

      if (result.success && result.data && result.data.stock) {
        const stats = result.data.latestDayStats || {}
        const stockInfo = result.data.stock

        setStockData({
          symbol: stockInfo.symbol,
          name: stockInfo.name,
          // DB fallback values (will be overridden by EC2 live data)
          price: stats.close ?? 0,
          change: stats.change ?? 0,
          changePercent: stats.changePercent ?? 0,
          high: stats.high ?? 0,
          low: stats.low ?? 0,
          open: stats.open ?? 0,
          prevClose: stats.prevClose ?? 0,
          volume: stats.volume ? (stats.volume / 1000000).toFixed(1) + 'M' : '—',
        })
      } else {
        setStockData({ symbol, name: symbol, price: 0, change: 0, changePercent: 0, high: 0, low: 0, open: 0, prevClose: 0, volume: '—' })
      }
    } catch {
      setStockData({ symbol, name: symbol, price: 0, change: 0, changePercent: 0, high: 0, low: 0, open: 0, prevClose: 0, volume: '—' })
    } finally {
      setLoading(false)
    }
  }

  // ── 2. EC2 Live Price polling (every 2s) ──
  useEffect(() => {
    let id: NodeJS.Timeout | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/live-price?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const d = json?.data?.[symbol] || json?.data
        if (d?.ltp) {
          setLivePrice(d.ltp)
          if (d.change !== undefined) setLiveChange(d.change)
          if (d.change_pct !== undefined) setLiveChangePct(d.change_pct)
        }
      } catch { /* silent */ }
    }

    poll()
    id = setInterval(poll, 2000)
    return () => { if (id) clearInterval(id) }
  }, [symbol])

  // ── 3. EC2 Live OHLC polling (every 10s) — Open/High/Low/PrevClose from today's candles ──
  useEffect(() => {
    let id: NodeJS.Timeout | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/live-ohlc?symbol=${symbol}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (json.success && json.data) {
          const d = json.data
          setLiveOHLC({ open: d.open, high: d.high, low: d.low, prevClose: d.prevClose })
          // If EC2 also gives us change/change_pct and we don't have live price yet
          if (d.change !== null && liveChange === null) setLiveChange(d.change)
          if (d.change_pct !== null && liveChangePct === null) setLiveChangePct(d.change_pct)
        }
      } catch { /* silent */ }
    }

    poll()
    id = setInterval(poll, 10000)
    return () => { if (id) clearInterval(id) }
  }, [symbol])

  if (loading || !stockData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center">
        <Loader size={64} />
      </div>
    )
  }

  // ── Merge: EC2 live data takes priority over DB values ──
  const displayPrice = livePrice ?? stockData.price
  const displayChange = liveChange ?? stockData.change
  const displayChangePct = liveChangePct ?? stockData.changePercent
  const displayOpen = liveOHLC?.open ?? stockData.open
  const displayHigh = liveOHLC?.high ?? stockData.high
  const displayLow = liveOHLC?.low ?? stockData.low
  const displayPrevClose = liveOHLC?.prevClose ?? stockData.prevClose

  const isPositive = (displayChange ?? 0) >= 0

  const fmt = (v: number | null | undefined) =>
    v != null ? `₹${Number(v).toFixed(2)}` : '—'

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
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Stock Header */}
            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-white/10">
              <div className="flex items-start justify-between mb-3 md:mb-4">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className={`w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br ${isPositive ? 'from-emerald-500 to-green-600' : 'from-red-500 to-rose-600'} rounded-2xl flex items-center justify-center shadow-lg`}>
                    <span className="text-white font-bold text-lg md:text-2xl">{stockData.name.charAt(0)}</span>
                  </div>
                  <div>
                    <h1 className="text-xl md:text-3xl font-bold text-white">{stockData.name}</h1>
                    <p className="text-sm md:text-base text-gray-400">NSE: {stockData.symbol}</p>
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

              {/* Price Row */}
              <div className="flex flex-wrap items-baseline gap-2 md:gap-3">
                <span className="text-3xl md:text-4xl font-bold text-white transition-all duration-300">
                  {fmt(displayPrice)}
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

              {/* OHLC Row */}
              <div className="mt-4 md:mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 pt-4 border-t border-white/10">
                <div>
                  <p className="text-xs md:text-sm text-gray-500">Open</p>
                  <p className="text-base md:text-lg font-semibold text-white">{fmt(displayOpen)}</p>
                </div>
                <div>
                  <p className="text-xs md:text-sm text-gray-500">High</p>
                  <p className="text-base md:text-lg font-semibold text-emerald-400">{fmt(displayHigh)}</p>
                </div>
                <div>
                  <p className="text-xs md:text-sm text-gray-500">Low</p>
                  <p className="text-base md:text-lg font-semibold text-red-400">{fmt(displayLow)}</p>
                </div>
                <div>
                  <p className="text-xs md:text-sm text-gray-500">Prev. Close</p>
                  <p className="text-base md:text-lg font-semibold text-white">{fmt(displayPrevClose)}</p>
                </div>
              </div>
            </div>

            {/* Chart — DB data, always */}
            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 border border-white/10">
              <StockChart symbol={symbol} />
            </div>

            {/* Insights Panel */}
            <InsightsPanel symbol={symbol} />

            {/* Technical Indicators */}
            <TechnicalIndicatorsList symbol={symbol} />
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

function MessageSquare({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}
