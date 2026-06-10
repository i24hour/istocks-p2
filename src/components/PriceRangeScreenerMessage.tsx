'use client'

import { LayoutGrid } from 'lucide-react'
import { MarkdownMessage } from '@/components/MarkdownMessage'
import { cn } from '@/lib/utils'

/**
 * Detects assistant markdown produced by the price-band screener branch in ai-engine
 * (header line + stock blocks separated by blank lines). Parsing only; does not alter content.
 */
export function parsePriceRangeScreenerMarkdown(content: string): { summary: string; stocksMarkdown: string[] } | null {
  const trimmed = content.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const first = parts[0]
  // Matches: Found **N stocks** in ₹min–₹max range (scanned X symbols, Y liquid) — 🟢 EC2 live
  const headerRe =
    /^Found \*\*\d+ stocks\*\* in ₹[\d.]+\s*[\u2013-]\s*₹[\d.]+\s+range \(scanned \d+ symbols, \d+ liquid\)\s*[\u2014-]\s*(🟢 EC2 live|🟡 Yahoo fallback)\s*$/u
  if (!headerRe.test(first)) return null

  const stocksMarkdown = parts.slice(1)
  return { summary: first, stocksMarkdown }
}

export function PriceRangeScreenerMessage({ summary, stocksMarkdown }: { summary: string; stocksMarkdown: string[] }) {
  const isEc2 = summary.includes('EC2 live')

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-xl border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] px-3.5 py-3 sm:px-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]',
          'border-l-[3px]',
          isEc2 ? 'border-l-emerald-500' : 'border-l-amber-500',
        )}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--card-bg)]',
            )}
            aria-hidden
          >
            <LayoutGrid className={cn('h-4 w-4', isEc2 ? 'text-emerald-600' : 'text-amber-600')} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Price band picks
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                  isEc2
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-400',
                )}
              >
                {isEc2 ? 'EC2 live' : 'Yahoo fallback'}
              </span>
            </div>
            <div className="mt-1.5 [&_p]:mb-0">
              <MarkdownMessage content={summary} className="text-[13px] sm:text-sm font-medium leading-snug" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-3.5">
        {stocksMarkdown.map((block, i) => (
          <div
            key={`${i}-${block.slice(0, 24)}`}
            className={cn(
              'relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg)] px-3.5 py-3 sm:px-4 sm:py-3.5',
              'shadow-[var(--shadow-sm)]',
            )}
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/35 to-transparent',
              )}
              aria-hidden
            />
            <div className="flex gap-3">
              <span
                className="flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/12 text-xs font-bold tabular-nums text-[var(--accent)]"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 [&_p]:mb-1.5 [&_p:last-child]:mb-0">
                <MarkdownMessage content={block} className="text-[12px] sm:text-[13px] leading-relaxed" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MaybePriceRangeScreenerMarkdown({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const parsed = parsePriceRangeScreenerMarkdown(content)
  if (parsed) {
    return <PriceRangeScreenerMessage summary={parsed.summary} stocksMarkdown={parsed.stocksMarkdown} />
  }
  return <MarkdownMessage content={content} className={className} />
}
