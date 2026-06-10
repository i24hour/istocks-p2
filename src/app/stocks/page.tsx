'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
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
  prevClose?: number | null  // used to compute change from EC2 ltp
}

const toNumberOrNull = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const applyLiveQuote = (stock: StockData, live: any): StockData => {
  const ltp = toNumberOrNull(live?.ltp)
  if (ltp === null || ltp <= 0) return stock

  let change = toNumberOrNull(live?.change)
  let changePct = toNumberOrNull(live?.change_pct ?? live?.changePercent)

  if (change === null && stock.prevClose) {
    change = parseFloat((ltp - stock.prevClose).toFixed(2))
    changePct = parseFloat(((change / stock.prevClose) * 100).toFixed(2))
  }

  return { ...stock, latestPrice: ltp, change, changePercent: changePct }
}

const STOCKS_FETCH_TIMEOUT_MS = 20_000

export default function StocksPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [stocks, setStocks] = useState<StockData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [query, setQuery] = useState('')
  const stocksRef = useRef<StockData[]>([])

  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  useEffect(() => {
    fetchStocks()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncFromUrl = () => {
      const q = new URLSearchParams(window.location.search).get('q') || ''
      setQuery(q.trim().toLowerCase())
    }

    const onHeaderSearch = (event: Event) => {
      const custom = event as CustomEvent<{ query?: string }>
      const q = custom.detail?.query || ''
      setQuery(q.trim().toLowerCase())
    }

    syncFromUrl()
    window.addEventListener('istocks-search', onHeaderSearch as EventListener)
    window.addEventListener('popstate', syncFromUrl)
    return () => {
      window.removeEventListener('istocks-search', onHeaderSearch as EventListener)
      window.removeEventListener('popstate', syncFromUrl)
    }
  }, [])

  const fetchStocks = async () => {
    abortRef.current?.abort()

    let lastError: any = null

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController()
      abortRef.current = controller
      const timeout = setTimeout(() => controller.abort(), STOCKS_FETCH_TIMEOUT_MS)

      try {
        const response = await fetch('/api/stocks', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const result = await response.json()

        if (result.success && result.data) {
          setStocks(result.data)
          setError(null)
          setLoading(false)
          return
        }

        throw new Error(result.error || 'Failed to load stocks')
      } catch (error: any) {
        lastError = error
        if (attempt < 2) {
          continue
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    if (lastError?.name === 'AbortError') {
      setError('Request timed out. Please reload.')
    } else {
      console.error('Error fetching stocks:', lastError)
      setError(lastError?.message || 'Failed to load stocks')
    }

    setLoading(false)
  }

  // ── EC2 live prices: POST one batch of all symbols (small EC2 response; avoids 5s timeout on full dump) ──
  useEffect(() => {
    if (stocks.length === 0) return
    let id: NodeJS.Timeout | null = null

    const poll = async () => {
      try {
        const list = stocksRef.current.map((s) => s.symbol.toUpperCase())
        if (list.length === 0) return

        const res = await fetch('/api/live-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: list }),
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = await res.json()
        if (!json?.success || !json?.data) return

        setStocks((prev) =>
          prev.map((stock) => {
            const live = json.data[stock.symbol] || json.data[stock.symbol.toUpperCase()]
            return live ? applyLiveQuote(stock, live) : stock
          }),
        )
      } catch {
        // Silent failures — keep list usable
      }
    }

    poll()
    id = setInterval(poll, 2000)
    return () => {
      if (id) clearInterval(id)
    }
  }, [stocks.length])

  const getGradientColors = (symbol: string, change: number | null) => {
    if (symbol === 'NIFTY') return 'from-blue-600 to-indigo-600 animate-pulse-slow' // Special color for NIFTY
    if (change === null) return 'from-gray-600 to-gray-700'
    if (change >= 0) return 'from-emerald-400 to-emerald-500'
    return 'from-red-500 to-rose-600'
  }

  const filteredStocks = useMemo(() => {
    if (!query) return stocks
    return stocks.filter((stock) => {
      const symbol = stock.symbol.toLowerCase()
      const name = stock.name.toLowerCase()
      return symbol.includes(query) || name.includes(query)
    })
  }, [stocks, query])

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300">
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 md:py-12">
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold text-white mb-3 md:mb-4">
            AI-Powered <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-400 bg-clip-text text-transparent">Stock Analysis</span>
          </h1>
          <p className="text-base md:text-xl text-gray-400">
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
            filteredStocks.length === 0 ? (
              <div className="text-center py-10 rounded-2xl border border-white/10 bg-dark-100/40">
                <p className="text-white font-medium">No stocks found for "{query}".</p>
                <p className="text-sm text-gray-400 mt-1">Try symbol like RELIANCE or name like HDFC.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                {filteredStocks.map((stock) => (
                  <div
                    key={stock.symbol}
                    onClick={() => router.push(`/stock/${stock.symbol}`)}
                    className="group bg-dark-100/60 backdrop-blur-xl rounded-2xl hover:shadow-xl transition-all cursor-pointer p-4 md:p-6 border border-white/10 hover:border-emerald-400/25 active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3 mb-3 md:mb-4">
                      <StockLogo
                        symbol={stock.symbol}
                        name={stock.name}
                        exchange={stock.exchange}
                        fallbackGradientClassName={getGradientColors(stock.symbol, stock.change)}
                      />
                      <div className="flex-1 min-w-0">
                        <h2 className="text-base md:text-lg font-bold text-white group-hover:text-emerald-400 transition-colors truncate">{stock.name}</h2>
                        <p className="text-xs md:text-sm text-gray-500">{stock.exchange}: {stock.symbol}</p>
                      </div>
                    </div>

                    {stock.latestPrice !== null ? (
                      <>
                        <div className="mb-2">
                          <div className="text-xl md:text-2xl font-bold text-white">₹{stock.latestPrice.toFixed(2)}</div>
                          {stock.change !== null && stock.changePercent !== null && (
                            <div className={`flex items-center gap-1 text-sm ${stock.change < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {stock.change < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                              <span className="font-semibold">
                                {stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)} ({stock.changePercent.toFixed(2)}%)
                              </span>
                            </div>
                          )}
                        </div>

                        {typeof stock.volume === 'number' && stock.volume > 0 && (
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
            )
          )}
        </div>
      </main>

      {/* Telegram Bot Floating Button */}
      <div className="fixed bottom-5 right-5 md:bottom-7 md:right-7 z-50 flex items-center gap-2">
        <span className="hidden md:inline-flex rounded-full border border-blue-400/30 bg-dark-300/85 px-3 py-1.5 text-xs font-medium text-blue-200 shadow-lg backdrop-blur">
          Chat on Telegram
        </span>
        <a
          href="https://t.me/IstocksAIbot"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open iStocks Telegram bot"
          className="h-14 w-14 rounded-full bg-[#229ED9] shadow-xl ring-1 ring-white/20 transition-transform duration-200 hover:scale-105 active:scale-95 flex items-center justify-center"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="currentColor" aria-hidden="true">
            <path d="M21.99 4.52a1 1 0 0 0-1.27-1.22L2.58 9.78a1 1 0 0 0 .05 1.9l4.68 1.47 1.65 5.07a1 1 0 0 0 1.83.2l2.32-3.73 4.67 3.43a1 1 0 0 0 1.57-.63l2.64-12.97ZM8.4 12.74l9.64-6.14-7.42 7.66a1 1 0 0 0-.22.39l-.85 2.63-.9-2.76a1 1 0 0 0-.65-.65l-2.6-.82Z" />
          </svg>
        </a>
      </div>
    </div>
  )
}
