'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, Database, Loader2 } from 'lucide-react'

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
  status: 'LIVE' | 'CLOSED'
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

const MOCK_AMOUNT_KEY = 'istocks_mock_amount_v1'

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

export default function PnLDashboard() {
  const [holdings, setHoldings] = useState<HoldingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [mockAmount, setMockAmount] = useState(100000)
  const [mockInput, setMockInput] = useState('100000')

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

  useEffect(() => {
    fetchHoldings()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(MOCK_AMOUNT_KEY)
    if (!stored) return
    const parsed = Number(stored)
    if (!Number.isFinite(parsed) || parsed < 0) return
    setMockAmount(parsed)
    setMockInput(String(parsed))
  }, [])

  const saveMockAmount = () => {
    const parsed = Number(mockInput)
    if (!Number.isFinite(parsed) || parsed < 0) return
    setMockAmount(parsed)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MOCK_AMOUNT_KEY, String(parsed))
    }
  }

  const liveCount = useMemo(() => holdings.filter(h => h.isLive).length, [holdings])

  useEffect(() => {
    if (liveCount === 0) return

        const update = async () => {
      try {
        const liveSyms = holdings.filter((h) => h.isLive).map((h) => h.symbol.toUpperCase())
        if (liveSyms.length === 0) return
        const r = await fetch('/api/live-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: liveSyms }),
          cache: 'no-store',
        })
        if (!r.ok) return

        const j = await r.json()
        if (!j?.success || !j?.data) return

        const missingSymbols = new Set<string>()

        setHoldings(prev => prev.map(h => {
          if (!h.isLive) return h
          const ld = j.data[h.symbol]
          if (!ld || typeof ld.ltp !== 'number') {
            missingSymbols.add(h.symbol)
            return h
          }

          const marketPrice = ld.ltp
          const returns = (marketPrice - h.avgPrice) * h.quantity * (h.action === 'BUY' ? 1 : -1)
          return { ...h, marketPrice, returns }
        }))

        if (missingSymbols.size > 0) {
          const fallbackResults = await Promise.all(
            Array.from(missingSymbols).map(async (symbol) => {
              try {
                const sr = await fetch(`/api/live-price?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
                if (!sr.ok) return { symbol, price: null }
                const sj = await sr.json()
                if (!sj?.success || !sj?.data) return { symbol, price: null }
                const d = sj.data[symbol] || sj.data
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
              return { ...h, marketPrice: price, returns }
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
    const invested = holdings.reduce((sum, h) => sum + h.investedAmount, 0)
    const pnl = holdings.reduce((sum, h) => sum + h.returns, 0)
    const currentValue = invested + pnl
    const closedPnl = holdings.filter(h => !h.isLive).reduce((sum, h) => sum + h.returns, 0)
    const livePnl = holdings.filter(h => h.isLive).reduce((sum, h) => sum + h.returns, 0)
    const netMockValue = mockAmount + pnl

    return {
      invested,
      pnl,
      currentValue,
      closedPnl,
      livePnl,
      netMockValue,
      totalTrades: holdings.length,
      liveCount: holdings.filter(h => h.isLive).length,
      closedCount: holdings.filter(h => !h.isLive).length,
    }
  }, [holdings, mockAmount])

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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-white">P&L Dashboard</h1>
            <p className="text-sm text-gray-400 mt-1">Sab trades ka total profit/loss + live positions</p>
          </div>
          <button
            onClick={fetchHoldings}
            className="px-3 py-2 rounded-lg border border-white/10 bg-dark-300/50 text-sm text-gray-300 hover:bg-dark-300 transition-colors"
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-dark-300/40 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <p className="text-sm font-medium text-white">Total Mock Amount</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={mockInput}
              onChange={(e) => setMockInput(e.target.value)}
              type="number"
              min={0}
              placeholder="Enter total mock capital"
              className="flex-1 px-3 py-2 bg-dark-400/50 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            <button
              onClick={saveMockAmount}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
              type="button"
            >
              Save Amount
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard label="Total P&L" value={`₹${summary.pnl >= 0 ? '+' : ''}${formatCurrency(summary.pnl)}`} positive={summary.pnl >= 0} />
          <SummaryCard label="Net Mock Value" value={`₹${formatCurrency(summary.netMockValue)}`} />
          <SummaryCard label="Total Invested" value={`₹${formatCurrency(summary.invested)}`} />
          <SummaryCard label="Current Value" value={`₹${formatCurrency(summary.currentValue)}`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <MiniCard label="Total Trades" value={String(summary.totalTrades)} />
          <MiniCard label="Live Trades P&L" value={`₹${summary.livePnl >= 0 ? '+' : ''}${formatCurrency(summary.livePnl)}`} positive={summary.livePnl >= 0} />
          <MiniCard label="Closed Trades P&L" value={`₹${summary.closedPnl >= 0 ? '+' : ''}${formatCurrency(summary.closedPnl)}`} positive={summary.closedPnl >= 0} />
        </div>

        {holdings.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-dark-300/30 p-10 text-center">
            <Database className="w-10 h-10 mx-auto text-gray-500 mb-3" />
            <p className="text-lg text-white font-medium">No trades yet</p>
            <p className="text-sm text-gray-400 mt-1">AI Database me paper trade loge to yaha full P&L aa jayega.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-12 bg-dark-300/70 px-4 py-3 text-[11px] text-gray-400 uppercase tracking-wide">
              <div className="col-span-2">Symbol</div>
              <div className="col-span-1">Side</div>
              <div className="col-span-1">Qty</div>
              <div className="col-span-1">Buy</div>
              <div className="col-span-1">Sell/Live</div>
              <div className="col-span-2">Invested</div>
              <div className="col-span-1">P&L</div>
              <div className="col-span-1">RSI</div>
              <div className="col-span-1">Target</div>
              <div className="col-span-1">Status</div>
            </div>
            {holdings.map((h) => {
              const positive = h.returns >= 0
              return (
                <div key={h.id} className="grid grid-cols-12 px-4 py-3 border-t border-white/5 text-sm items-center">
                  <div className="col-span-2 text-white font-medium">
                    {h.symbol}
                    <div className="text-[11px] text-gray-500">{new Date(h.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="col-span-1 text-gray-300">{h.action}</div>
                  <div className="col-span-1 text-gray-300">{h.quantity}</div>
                  <div className="col-span-1 text-gray-300">₹{formatCurrency(h.avgPrice)}</div>
                  <div className="col-span-1 text-gray-300">₹{formatCurrency(h.marketPrice)}</div>
                  <div className="col-span-2 text-gray-300">₹{formatCurrency(h.investedAmount)}</div>
                  <div className={`col-span-1 font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{positive ? '+' : ''}{formatCurrency(h.returns)}
                    {typeof h.currentProfitPct === 'number' && (
                      <div className={`text-[10px] ${h.currentProfitPct >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                        {h.currentProfitPct >= 0 ? '+' : ''}{h.currentProfitPct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 text-gray-300 text-xs">
                    {typeof h.liveIndicators?.rsi === 'number' ? h.liveIndicators.rsi.toFixed(2) : '-'}
                  </div>
                  <div className="col-span-1 text-gray-300 text-xs">
                    {typeof h.targetProfitPct === 'number'
                      ? `${h.targetProfitPct.toFixed(2)}%${typeof h.targetProgressPct === 'number' ? ` (${Math.max(0, h.targetProgressPct).toFixed(1)}%)` : ''}`
                      : '-'}
                  </div>
                  <div className="col-span-1">
                    {h.isLive ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                        <Activity className="w-3 h-3" /> LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-gray-500/30 bg-gray-500/10 text-gray-400">
                        CLOSED
                      </span>
                    )}
                  </div>

                  {(h.strategyParams?.length > 0 || h.conditions?.length > 0) && (
                    <div className="col-span-12 mt-2 rounded-md border border-white/10 bg-dark-400/30 p-2 space-y-1">
                      {h.strategyParams?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {h.strategyParams.map((param) => (
                            <span key={param.key} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-gray-300">
                              {param.label}: {param.value}
                            </span>
                          ))}
                        </div>
                      )}
                      {h.conditions?.length > 0 && (
                        <div className="space-y-0.5">
                          {h.conditions.map((condition, idx) => (
                            <p key={`${condition.indicator}-${idx}`} className={`text-[10px] ${condition.isMet ? 'text-emerald-300' : 'text-amber-300'}`}>
                              {condition.indicator} {condition.operator} {condition.threshold}
                              {typeof condition.currentValue === 'number' ? ` • current ${condition.currentValue.toFixed(2)}` : ' • current NA'}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function SummaryCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {value}
      </p>
    </div>
  )
}

function MiniCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className={`text-base font-semibold mt-1 ${positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {value}
      </p>
    </div>
  )
}
