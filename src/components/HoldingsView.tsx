'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Database, Loader2, LogOut, TrendingUp, X } from 'lucide-react'
import { AnimatedHoldingCard } from './ui/animated-holding-card'

interface BrokerHolding {
  symbol: string
  quantity: number
  averagePrice: number
  ltp: number
  investedValue: number
  currentValue: number
  pnl: number
  pnlPercent: number
  exchange?: string
}

interface BrokerPortfolio {
  broker: string
  data: BrokerHolding[]
  summary: { totalInvested: number; totalCurrent: number; totalPnl: number; totalPnlPercent: number; count: number }
}

interface HoldingItem {
  id: string
  sessionId: string
  createdAt: string
  symbol: string
  action: 'BUY' | 'SELL'
  quantity: number
  avgPrice: number
  marketPrice: number
  returns: number
  investedAmount: number
  isLive: boolean
  status: 'LIVE' | 'CONDITION' | 'CONDITION_NOT_MET' | 'CLOSED'
  priceSource: string
  strategyParams: Array<{ key: string; label: string; value: string }>
  conditions: Array<{
    indicator: string
    operator: '<' | '<=' | '>' | '>=' | '='
    threshold: number
    currentValue?: number
    isMet?: boolean
  }>
  targetProfitPct?: number
  targetPrice?: number
  currentProfitPct?: number
  targetProgressPct?: number
  liveIndicators: Record<string, number>
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

export default function HoldingsView() {
  const [holdings, setHoldings] = useState<HoldingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [exitingId, setExitingId] = useState<string | null>(null)
  const [exitError, setExitError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'LIVE' | 'CONDITION' | 'CLOSED' | 'BROKER'>('LIVE')
  const [pnlView, setPnlView] = useState<'exited' | 'live'>('exited')
  const [brokerPortfolio, setBrokerPortfolio] = useState<BrokerPortfolio | null>(null)
  const [brokerLoading, setBrokerLoading] = useState(false)
  const [brokerError, setBrokerError] = useState<string | null>(null)
  const holdingsRef = useRef<HoldingItem[]>([])

  const fetchHoldings = async () => {
    try {
      const res = await fetch('/api/holdings', { cache: 'no-store' })
      const data = await res.json()
      if (data.success) {
        setHoldings(data.data)
      }
    } catch {
      setHoldings([])
    } finally {
      setLoading(false)
    }
  }

  const fetchBrokerPortfolio = async () => {
    setBrokerLoading(true)
    setBrokerError(null)
    try {
      const res = await fetch('/api/trading/broker-portfolio', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setBrokerError(data.error || 'Failed to fetch broker portfolio')
        return
      }
      setBrokerPortfolio(data.broker ? data : null)
    } catch {
      setBrokerError('Network error fetching broker portfolio')
    } finally {
      setBrokerLoading(false)
    }
  }

  const handleExit = async (holdingId: string, exitPrice: number) => {
    const prev = holdingsRef.current.find((h) => h.id === holdingId)
    if (!prev) return

    setExitError(null)

    const optimisticReturns =
      (exitPrice - prev.avgPrice) * prev.quantity * (prev.action === 'BUY' ? 1 : -1)

    setHoldings((list) =>
      list.map((h) =>
        h.id === holdingId
          ? {
              ...h,
              status: 'CLOSED',
              isLive: false,
              marketPrice: exitPrice,
              returns: optimisticReturns,
              priceSource: 'Exited',
            }
          : h
      )
    )
    setExitingId(null)

    try {
      const res = await fetch('/api/holdings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdingId, exitPrice }),
      })
      const data = await res.json()
      if (data.success) {
        const ep = typeof data.exitPrice === 'number' ? data.exitPrice : exitPrice
        const fr = typeof data.returns === 'number' ? data.returns : optimisticReturns
        if (Number.isFinite(ep) && ep > 0) {
          setHoldings((list) =>
            list.map((h) =>
              h.id === holdingId
                ? { ...h, marketPrice: ep, returns: fr, priceSource: 'Exited' }
                : h
            )
          )
        }
        void fetchHoldings()
      } else {
        setHoldings((list) =>
          list.map((h) => (h.id === holdingId ? prev : h))
        )
        setExitError(data?.error || 'Exit failed.')
      }
    } catch (err) {
      console.error('Exit failed:', err)
      setHoldings((list) =>
        list.map((h) => (h.id === holdingId ? prev : h))
      )
      setExitError('Exit failed. Please try again.')
    }
  }

  useEffect(() => {
    fetchHoldings()
  }, [])

  useEffect(() => {
    if (activeTab === 'BROKER' && !brokerPortfolio && !brokerLoading) {
      fetchBrokerPortfolio()
    }
  }, [activeTab])

  useEffect(() => {
    holdingsRef.current = holdings
  }, [holdings])

  const liveCount = useMemo(() => holdings.filter(h => h.isLive).length, [holdings])

  useEffect(() => {
    if (liveCount === 0) return

    const update = async () => {
      try {
        const liveSymbols = Array.from(
          new Set(
            holdingsRef.current
              .filter((h) => h.isLive)
              .map((h) => h.symbol.toUpperCase())
          )
        )

        if (liveSymbols.length === 0) return

        const r = await fetch(`/api/live-price?symbols=${encodeURIComponent(liveSymbols.join(','))}`, { cache: 'no-store' })
        if (!r.ok) return

        const j = await r.json()
        if (!j?.success || !j?.data) return

        const missingSymbols = new Set<string>()

        setHoldings(prev => prev.map(h => {
          if (!h.isLive) return h
          const ld = j.data[h.symbol] || j.data[h.symbol.toUpperCase()]
          if (!ld || typeof ld.ltp !== 'number') {
            missingSymbols.add(h.symbol)
            return h
          }

          const marketPrice = ld.ltp
          const returns = (marketPrice - h.avgPrice) * h.quantity * (h.action === 'BUY' ? 1 : -1)
          const currentProfitPct = h.avgPrice > 0
            ? h.action === 'BUY'
              ? ((marketPrice / h.avgPrice) - 1) * 100
              : ((h.avgPrice / marketPrice) - 1) * 100
            : 0
          return { ...h, marketPrice, returns, currentProfitPct }
        }))

        if (missingSymbols.size > 0) {
          const fallbackResults = await Promise.all(
            Array.from(missingSymbols).map(async (symbol) => {
              try {
                const sr = await fetch(`/api/live-price?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
                if (!sr.ok) return { symbol, price: null }
                const sj = await sr.json()
                if (!sj?.success || !sj?.data) return { symbol, price: null }
                const d = sj.data[symbol] || sj.data[symbol.toUpperCase()] || sj.data
                return { symbol, price: typeof d?.ltp === 'number' ? d.ltp : null }
              } catch {
                return { symbol, price: null }
              }
            })
          )

          const fallbackMap = new Map(
            fallbackResults
              .filter(item => typeof item.price === 'number')
              .map(item => [item.symbol, item.price as number])
          )

          if (fallbackMap.size > 0) {
            setHoldings(prev => prev.map(h => {
              if (!h.isLive) return h
              const price = fallbackMap.get(h.symbol)
              if (typeof price !== 'number') return h
              const returns = (price - h.avgPrice) * h.quantity * (h.action === 'BUY' ? 1 : -1)
              const currentProfitPct = h.avgPrice > 0
                ? h.action === 'BUY'
                  ? ((price / h.avgPrice) - 1) * 100
                  : ((h.avgPrice / price) - 1) * 100
                : 0
              return { ...h, marketPrice: price, returns, currentProfitPct }
            }))
          }
        }
      } catch {
        // no-op
      }
    }

    update()
    const interval = setInterval(update, 2000)
    return () => clearInterval(interval)
  }, [liveCount])

  const summary = useMemo(() => {
    return holdings.reduce((acc, h) => {
      acc.invested += h.investedAmount
      acc.pnl += h.returns
      if (h.status === 'CLOSED') acc.exitedPnl += h.returns
      else if (h.status === 'LIVE') acc.livePnl += h.returns
      return acc
    }, { invested: 0, pnl: 0, livePnl: 0, exitedPnl: 0 })
  }, [holdings])

  const conditionHoldings = useMemo(
    () => holdings.filter(h => h.status === 'CONDITION' || h.status === 'CONDITION_NOT_MET'),
    [holdings]
  )
  const liveHoldings = useMemo(() => holdings.filter(h => h.status === 'LIVE'), [holdings])
  const closedHoldings = useMemo(() => holdings.filter(h => h.status === 'CLOSED'), [holdings])

  const tabMeta: Array<{
    key: 'LIVE' | 'CONDITION' | 'CLOSED'
    label: string
    count: number
    empty: string
    sectionTitle: string
    items: HoldingItem[]
  }> = [
    {
      key: 'LIVE',
      label: 'Live',
      count: liveHoldings.length,
      empty: 'No live holdings.',
      sectionTitle: 'Live Holdings',
      items: liveHoldings,
    },
    {
      key: 'CONDITION',
      label: 'Conditional',
      count: conditionHoldings.length,
      empty: 'No conditional holdings.',
      sectionTitle: 'Conditional Holdings',
      items: conditionHoldings,
    },
    {
      key: 'CLOSED',
      label: 'Closed',
      count: closedHoldings.length,
      empty: 'No closed holdings.',
      sectionTitle: 'Closed Holdings',
      items: closedHoldings,
    },
  ]

  const currentTab = tabMeta.find(tab => tab.key === activeTab) || tabMeta[0]

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-200 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-200">
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">Holdings</h1>
            <p className="text-sm text-gray-400 mt-1">Paper trades from AI Database</p>
          </div>
          <button
            onClick={fetchHoldings}
            className="px-3 py-2 rounded-lg border border-white/10 bg-dark-300/50 text-sm text-gray-300 hover:bg-dark-300 transition-colors"
            type="button"
          >
            Refresh
          </button>
        </div>

        {exitError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {exitError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs text-gray-500 uppercase">Total Invested</p>
            <p className="text-xl font-semibold text-white">₹{formatCurrency(summary.invested)}</p>
          </div>

          {/* ── Total P&L card with Exited / Live toggle ─────────────── */}
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 uppercase">Total P&amp;L</p>
              {/* sliding pill toggle */}
              <div className="relative flex items-center rounded-full bg-dark-200/80 border border-white/10 p-0.5">
                {/* sliding bg */}
                <span
                  className={`absolute top-0.5 bottom-0.5 rounded-full bg-white/10 transition-all duration-200 ${pnlView === 'exited' ? 'left-0.5 right-[calc(50%+1px)]' : 'left-[calc(50%+1px)] right-0.5'}`}
                />
                <button
                  type="button"
                  onClick={() => setPnlView('exited')}
                  className={`relative z-10 px-2.5 py-0.5 text-[11px] font-semibold rounded-full transition-colors ${pnlView === 'exited' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Exited
                </button>
                <button
                  type="button"
                  onClick={() => setPnlView('live')}
                  className={`relative z-10 px-2.5 py-0.5 text-[11px] font-semibold rounded-full transition-colors ${pnlView === 'live' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Live
                </button>
              </div>
            </div>
            {/* value */}
            {pnlView === 'exited' ? (
              <p className={`text-xl font-semibold ${summary.exitedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {summary.exitedPnl >= 0 ? '+' : ''}₹{formatCurrency(summary.exitedPnl)}
              </p>
            ) : (
              <p className={`text-xl font-semibold ${summary.livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {summary.livePnl >= 0 ? '+' : ''}₹{formatCurrency(summary.livePnl)}
              </p>
            )}
            <p className="text-[11px] text-gray-600">
              {pnlView === 'exited' ? 'Booked P&L from closed trades' : 'Unrealised P&L on open positions'}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs text-gray-500 uppercase">Live Positions</p>
            <p className="text-xl font-semibold text-white">{liveCount}</p>
          </div>
        </div>

        <div className="mb-8 overflow-x-auto">
          <div className="inline-flex min-w-full sm:min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-dark-300/40 p-1.5 sm:gap-2.5">
            {tabMeta.map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 sm:flex-none whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${isActive
                    ? 'bg-emerald-600 text-white border border-emerald-400/90 shadow-[0_1px_0_rgba(0,0,0,0.2),0_4px_14px_rgba(5,150,105,0.35)]'
                    : 'bg-transparent text-gray-400 border border-transparent hover:text-white hover:bg-white/10'
                    }`}
                  type="button"
                >
                  {tab.label}
                  <span className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${isActive ? 'bg-white/25 text-white' : 'bg-white/10 text-gray-400'}`}>
                    {tab.count}
                  </span>
                </button>
              )
            })}
            {/* Broker portfolio tab — shown always, fetches on click */}
            <button
              onClick={() => setActiveTab('BROKER')}
              className={`flex-1 sm:flex-none whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'BROKER'
                ? 'bg-blue-600 text-white border border-blue-400/90 shadow-[0_1px_0_rgba(0,0,0,0.2),0_4px_14px_rgba(37,99,235,0.35)]'
                : 'bg-transparent text-gray-400 border border-transparent hover:text-white hover:bg-white/10'
              }`}
              type="button"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              {brokerPortfolio?.broker
                ? `${brokerPortfolio.broker.charAt(0) + brokerPortfolio.broker.slice(1).toLowerCase()} Portfolio`
                : 'Broker Portfolio'}
              {brokerPortfolio && (
                <span className={`ml-1 inline-flex min-w-[1.5rem] justify-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${activeTab === 'BROKER' ? 'bg-white/25 text-white' : 'bg-white/10 text-gray-400'}`}>
                  {brokerPortfolio.summary.count}
                </span>
              )}
            </button>
          </div>
        </div>

        {activeTab === 'BROKER' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">
                  {brokerPortfolio?.broker
                    ? `${brokerPortfolio.broker.charAt(0) + brokerPortfolio.broker.slice(1).toLowerCase()} Holdings`
                    : 'Broker Holdings'}
                </h2>
              </div>
              <button
                onClick={fetchBrokerPortfolio}
                disabled={brokerLoading}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-dark-300/50 text-xs text-gray-300 hover:bg-dark-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                type="button"
              >
                {brokerLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Refresh
              </button>
            </div>

            {brokerLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              </div>
            )}

            {brokerError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {brokerError}
              </div>
            )}

            {!brokerLoading && !brokerError && brokerPortfolio && (
              <>
                {/* Summary row */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border border-white/10 bg-dark-300/40 p-3">
                    <p className="text-[10px] text-gray-500 uppercase mb-1">Invested</p>
                    <p className="text-base font-semibold text-white">₹{formatCurrency(brokerPortfolio.summary.totalInvested)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-dark-300/40 p-3">
                    <p className="text-[10px] text-gray-500 uppercase mb-1">Current</p>
                    <p className="text-base font-semibold text-white">₹{formatCurrency(brokerPortfolio.summary.totalCurrent)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-dark-300/40 p-3">
                    <p className="text-[10px] text-gray-500 uppercase mb-1">Total P&L</p>
                    <p className={`text-base font-semibold ${brokerPortfolio.summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {brokerPortfolio.summary.totalPnl >= 0 ? '+' : ''}₹{formatCurrency(brokerPortfolio.summary.totalPnl)}
                      <span className="text-xs ml-1 opacity-75">({brokerPortfolio.summary.totalPnlPercent >= 0 ? '+' : ''}{brokerPortfolio.summary.totalPnlPercent.toFixed(2)}%)</span>
                    </p>
                  </div>
                </div>

                {brokerPortfolio.data.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-dark-300/30 p-10 text-center">
                    <TrendingUp className="w-10 h-10 mx-auto text-gray-500 mb-3" />
                    <p className="text-sm text-gray-400">No holdings in your broker account.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {brokerPortfolio.data.map((h: any) => (
                      <div key={h.symbol} className="rounded-xl border border-white/10 bg-dark-300/40 p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-white">{h.symbol}</p>
                            <p className="text-xs text-gray-500">{h.quantity} shares · Avg ₹{Number(h.averagePrice).toFixed(2)}</p>
                          </div>
                          <div className="text-right">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${h.pnl >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                              {h.pnl >= 0 ? '+' : ''}{Number(h.pnlPercent).toFixed(2)}%
                            </span>
                            {h.dayChangePercent !== 0 && (
                              <p className={`text-[10px] mt-0.5 ${h.dayChangePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {h.dayChangePercent >= 0 ? '▲' : '▼'} {Math.abs(Number(h.dayChangePercent)).toFixed(2)}% today
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <p className="text-gray-500">LTP</p>
                            <p className="text-white font-medium">₹{Number(h.ltp).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Invested</p>
                            <p className="text-white font-medium">₹{formatCurrency(h.investedValue)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Current</p>
                            <p className="text-white font-medium">₹{formatCurrency(h.currentValue)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">P&L</p>
                            <p className={`font-medium ${h.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {h.pnl >= 0 ? '+' : ''}₹{formatCurrency(h.pnl)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {!brokerLoading && !brokerError && !brokerPortfolio && (
              <div className="rounded-2xl border border-white/10 bg-dark-300/30 p-10 text-center">
                <TrendingUp className="w-10 h-10 mx-auto text-gray-500 mb-3" />
                <p className="text-lg text-white font-medium">No broker connected</p>
                <p className="text-sm text-gray-400 mt-1">Connect a broker in Trading Settings to see your portfolio here.</p>
              </div>
            )}
          </div>
        ) : holdings.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-dark-300/30 p-10 text-center">
            <Database className="w-10 h-10 mx-auto text-gray-500 mb-3" />
            <p className="text-lg text-white font-medium">No holdings yet</p>
            <p className="text-sm text-gray-400 mt-1">AI Database me paper trade place karo, yaha automatically dikh jayega.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h2 className="text-lg font-semibold text-white">{currentTab.sectionTitle}</h2>
              </div>
              {currentTab.items.length === 0 ? (
                <p className="text-sm text-gray-500">{currentTab.empty}</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {currentTab.items.map((h) => (
                    <AnimatedHoldingCard
                      key={h.id}
                      holding={h}
                      exitingId={activeTab !== 'CLOSED' ? exitingId : undefined}
                      onExit={activeTab !== 'CLOSED' ? handleExit : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
