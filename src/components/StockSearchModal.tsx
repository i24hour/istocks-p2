'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, TrendingDown, TrendingUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StockSearchRow {
  symbol: string
  name: string
  exchange: string
  latestPrice: number | null
  change: number | null
  changePercent: number | null
  volume: number | null
  prevClose?: number | null
  lastUpdated?: string | null
}

const toNumberOrNull = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const applyLiveQuote = (stock: StockSearchRow, live: any): StockSearchRow => {
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

const FETCH_TIMEOUT_MS = 20_000

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after navigation (e.g. close mobile sidebar). */
  onAfterNavigate?: () => void
}

export function StockSearchModal({ open, onOpenChange, onAfterNavigate }: Props) {
  const router = useRouter()
  const [stocks, setStocks] = useState<StockSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const inputRef = useRef<HTMLInputElement>(null)
  const stocksRef = useRef<StockSearchRow[]>([])
  const listCache = useRef<StockSearchRow[] | null>(null)

  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return

    if (listCache.current && listCache.current.length > 0) {
      setStocks(listCache.current)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/stocks', { signal: controller.signal })
        const json = await res.json()
        if (cancelled) return
        if (json.success && Array.isArray(json.data)) {
          const normalized: StockSearchRow[] = json.data.map((r: any) => ({
            symbol: String(r.symbol),
            name: String(r.name || r.symbol),
            exchange: String(r.exchange || 'NSE'),
            latestPrice: r.latestPrice ?? null,
            change: r.change ?? null,
            changePercent: r.changePercent ?? null,
            volume: r.volume ?? null,
            prevClose: r.prevClose ?? null,
            lastUpdated: r.lastUpdated ?? null,
          }))
          normalized.sort((a, b) => a.symbol.localeCompare(b.symbol))
          listCache.current = normalized
          setStocks(normalized)
          setError(null)
        } else {
          setError(json.error || 'Failed to load stocks')
        }
      } catch (e: any) {
        if (cancelled) return
        if (e?.name === 'AbortError') setError('Request timed out')
        else setError('Could not load stocks')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(t)
      controller.abort()
    }
  }, [open])

  // EC2-backed live prices (same proxy as /stocks page — batches all symbols)
  useEffect(() => {
    if (!open || stocks.length === 0) return

    let id: ReturnType<typeof setInterval> | null = null

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
        if (listCache.current) {
          listCache.current = listCache.current.map((stock) => {
            const live = json.data[stock.symbol] || json.data[stock.symbol.toUpperCase()]
            return live ? applyLiveQuote(stock, live) : stock
          })
        }
      } catch {
        /* keep last good snapshot */
      }
    }

    poll()
    id = setInterval(poll, 2500)
    return () => {
      if (id) clearInterval(id)
    }
  }, [open, stocks.length])

  const filtered = useMemo(() => {
    if (!deferredQuery) return stocks
    return stocks.filter((s) => {
      const sym = s.symbol.toLowerCase()
      const nm = s.name.toLowerCase()
      return sym.includes(deferredQuery) || nm.includes(deferredQuery)
    })
  }, [stocks, deferredQuery])

  const pick = useCallback(
    (symbol: string) => {
      onOpenChange(false)
      router.push(`/stock/${encodeURIComponent(symbol)}`)
      onAfterNavigate?.()
    },
    [router, onOpenChange, onAfterNavigate],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-[max(4rem,8vh)] sm:pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-[var(--text-primary)]/35 backdrop-blur-[2px]"
        aria-label="Close stock search"
        onClick={() => onOpenChange(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search stocks"
        className={cn(
          'relative flex w-full max-w-lg max-h-[min(78vh,640px)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] shadow-2xl',
          'bg-[var(--bg-surface)] text-[var(--text-primary)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            placeholder="Search stocks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          <span>{loading ? 'Loading…' : `${filtered.length} shown`}</span>
          <span className="normal-case opacity-80">Live via EC2 feed</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain database-chat-scroll px-1 pb-2">
          {loading && stocks.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-sm text-red-500">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">No matches</p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((stock) => {
                const up = stock.change != null && stock.change >= 0
                const hasCh = stock.change != null && stock.changePercent != null
                const isStale = stock.lastUpdated != null &&
                  Date.now() - new Date(stock.lastUpdated).getTime() > 24 * 60 * 60 * 1000
                return (
                  <li key={stock.symbol}>
                    <button
                      type="button"
                      onClick={() => pick(stock.symbol)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        'hover:bg-[var(--bg-secondary)] active:scale-[0.99]',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-sm font-semibold tracking-tight">{stock.symbol}</div>
                        <div className="truncate text-xs text-[var(--text-muted)]">{stock.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {stock.exchange}: {stock.symbol}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {stock.latestPrice != null ? (
                          <>
                            <div className="flex items-center justify-end gap-1">
                              <div className="font-mono text-sm font-semibold">₹{stock.latestPrice.toFixed(2)}</div>
                              {isStale && (
                                <span className="text-[9px] text-amber-500/80 font-medium leading-none">old</span>
                              )}
                            </div>
                            {hasCh ? (
                              <div
                                className={cn(
                                  'flex items-center justify-end gap-0.5 text-xs font-medium',
                                  up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                                )}
                              >
                                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                <span>
                                  {up ? '+' : ''}
                                  {stock.change!.toFixed(2)} ({up ? '+' : ''}
                                  {stock.changePercent!.toFixed(2)}%)
                                </span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-[var(--text-muted)]">—</div>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-[var(--text-muted)]">—</div>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
