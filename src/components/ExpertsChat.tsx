'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
    Send, Trash2, Plus, ChevronDown, ChevronRight, ChevronLeft, ExternalLink,
    BookOpen, Newspaper, Calculator, MessageSquare, Loader2, Sparkles, Database,
    User, History, PanelLeft, Search, LogOut, BarChart3, Palette, Key, Bot,
} from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { APP_NAV_ITEMS } from '@/config/app-navigation'
import { StockSearchModal } from '@/components/StockSearchModal'
import { cn } from '@/lib/utils'
import type {
    ExpertsEvent, AgentReport, FinalProbabilityResult, ScoredArticle,
    SqlDataPoint, DiscussionTurn, AgentName
} from '@/lib/probability-agents/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExpertsSession {
    id: string
    title: string
    query: string
    createdAt: string
    analyses?: { finalProbability: number; finalConfidence: string; createdAt: string }[]
}

interface AgentState {
    status: 'idle' | 'searching' | 'done'
    searchQueries: { query: string; layer: number; label: string }[]
    articles: ScoredArticle[]
    sqlDataPoints: SqlDataPoint[]
    report?: AgentReport
    expanded: boolean
}

interface DiscussionState {
    rounds: { round: number; turns: DiscussionTurn[] }[]
    currentRound: number
}

interface AnalysisState {
    sessionId: string | null
    query: string
    agents: Record<AgentName, AgentState>
    discussion: DiscussionState
    finalResult?: FinalProbabilityResult
    isRunning: boolean
}

const emptyAgentState = (): AgentState => ({
    status: 'idle',
    searchQueries: [],
    articles: [],
    sqlDataPoints: [],
    expanded: false,
})

const emptyAnalysis = (): AnalysisState => ({
    sessionId: null,
    query: '',
    agents: {
        krishna: emptyAgentState(),
        chanakya: emptyAgentState(),
        aryabhata: emptyAgentState(),
    },
    discussion: { rounds: [], currentRound: 0 },
    isRunning: false,
})

const EXPERT_EMPTY_SUGGESTIONS = [
    'What is the probability RELIANCE closes above ₹1500 this week?',
    'What is the chance Indian markets rally in Q3 2025?',
    'Will Nifty 50 cross 26000 by end of 2025?',
] as const

// ─── Agent Meta ──────────────────────────────────────────────────────────────

const AGENT_META: Record<AgentName, { name: string; role: string; icon: typeof BookOpen; color: string; accent: string }> = {
    krishna: {
        name: 'Krishna',
        role: 'Historical Correlations',
        icon: BookOpen,
        color: 'from-amber-500/20 to-orange-500/10',
        accent: '#f59e0b',
    },
    chanakya: {
        name: 'Chanakya',
        role: 'Current Intelligence',
        icon: Newspaper,
        color: 'from-blue-500/20 to-cyan-500/10',
        accent: '#3b82f6',
    },
    aryabhata: {
        name: 'Aryabhata',
        role: 'Numerical Evidence',
        icon: Calculator,
        color: 'from-emerald-500/20 to-green-500/10',
        accent: '#34d399',
    },
}

// ─── Probability display helpers (plain language) ───────────────────────────

function clampPercent(value: number) {
    return Math.max(0, Math.min(100, Math.round(value)))
}

function getLikelihoodMeta(value: number) {
    const p = clampPercent(value)
    if (p >= 75) {
        return {
            label: 'Very likely',
            tone: 'Panels see strong evidence this will happen.',
            color: '#34d399',
            track: 'rgba(16, 185, 129, 0.15)',
        }
    }
    if (p >= 55) {
        return {
            label: 'Likely',
            tone: 'More likely than not, but not certain.',
            color: '#22c55e',
            track: 'rgba(34, 197, 94, 0.15)',
        }
    }
    if (p >= 45) {
        return {
            label: 'Roughly even',
            tone: 'Could go either way — close call.',
            color: '#f59e0b',
            track: 'rgba(245, 158, 11, 0.15)',
        }
    }
    if (p >= 25) {
        return {
            label: 'Unlikely',
            tone: 'Probably will not happen, but still possible.',
            color: '#f97316',
            track: 'rgba(249, 115, 22, 0.15)',
        }
    }
    return {
        label: 'Very unlikely',
        tone: 'Panels see weak evidence this will happen.',
        color: '#ef4444',
        track: 'rgba(239, 68, 68, 0.15)',
    }
}

function getFriendlyOdds(value: number) {
    const p = clampPercent(value)
    if (p <= 5) return 'Less than 1 in 20'
    if (p >= 95) return 'More than 19 in 20'
    const denominator = Math.max(2, Math.round(100 / p))
    return `About 1 in ${denominator}`
}

function getConfidenceMeta(confidence: string) {
    const key = confidence.toLowerCase()
    if (key === 'high') {
        return { label: 'High confidence', hint: 'Sources and agents largely agree.' }
    }
    if (key === 'low') {
        return { label: 'Low confidence', hint: 'Limited or conflicting evidence.' }
    }
    return { label: 'Medium confidence', hint: 'Reasonable evidence, some uncertainty.' }
}

function ProbabilityBar({ value, size = 'lg' }: { value: number; size?: 'sm' | 'lg' }) {
    const p = clampPercent(value)
    const meta = getLikelihoodMeta(p)
    const height = size === 'lg' ? 'h-3' : 'h-2'

    return (
        <div className="w-full">
            <div
                className={cn('relative w-full overflow-hidden rounded-full', height)}
                style={{ background: meta.track }}
                role="progressbar"
                aria-valuenow={p}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${p}% chance`}
            >
                <div
                    className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', height)}
                    style={{
                        width: `${p}%`,
                        background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color})`,
                        boxShadow: `0 0 12px ${meta.color}40`,
                    }}
                />
                {size === 'lg' && (
                    <>
                        <span className="absolute left-0 top-full mt-1 text-[10px] text-[var(--text-muted)]">0%</span>
                        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 text-[10px] text-[var(--text-muted)]">50%</span>
                        <span className="absolute right-0 top-full mt-1 text-[10px] text-[var(--text-muted)]">100%</span>
                    </>
                )}
            </div>
        </div>
    )
}

function VerdictHero({ value, confidence }: { value: number; confidence: string }) {
    const p = clampPercent(value)
    const likelihood = getLikelihoodMeta(p)
    const conf = getConfidenceMeta(confidence)

    return (
        <div className="mx-auto w-full max-w-lg space-y-4">
            <div className="text-center space-y-2">
                <p className="text-sm text-[var(--text-muted)]">Panel estimate</p>
                <p className="text-2xl sm:text-3xl font-semibold leading-snug text-[var(--text-primary)]">
                    <span style={{ color: likelihood.color }} className="font-bold tabular-nums">
                        {p}%
                    </span>{' '}
                    chance this happens
                </p>
                <p className="text-sm text-[var(--text-secondary)]">{getFriendlyOdds(p)} · {likelihood.tone}</p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
                <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border"
                    style={{
                        color: likelihood.color,
                        borderColor: `${likelihood.color}55`,
                        background: likelihood.track,
                    }}
                >
                    {likelihood.label}
                </span>
                <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    title={conf.hint}
                >
                    {conf.label}
                </span>
            </div>

            <div className="pt-1 pb-5">
                <ProbabilityBar value={p} size="lg" />
            </div>
        </div>
    )
}

function ExpertEstimateChip({
    value,
    accent,
    compact,
}: {
    value: number
    accent: string
    compact?: boolean
}) {
    const p = clampPercent(value)
    const meta = getLikelihoodMeta(p)

    if (compact) {
        return (
            <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{ color: meta.color, background: meta.track }}
            >
                {p}%
            </span>
        )
    }

    return (
        <div className="space-y-1.5 w-full">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tabular-nums" style={{ color: meta.color }}>
                    {p}%
                </span>
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                    {meta.label}
                </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: meta.track }}>
                <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${p}%`, background: accent }}
                />
            </div>
        </div>
    )
}

function AgentCard({
    name,
    state,
    onToggle,
}: {
    name: AgentName
    state: AgentState
    onToggle: () => void
}) {
    const meta = AGENT_META[name]
    const Icon = meta.icon
    const isActive = state.status === 'searching'
    const isDone = state.status === 'done'

    return (
        <div
            className="rounded-xl border overflow-hidden transition-all"
            style={{ borderColor: isDone ? meta.accent + '40' : 'var(--border-color)', background: 'var(--bg-surface)' }}
        >
            {/* Header */}
            <button
                className="w-full flex items-center gap-3 p-3 text-left"
                onClick={onToggle}
            >
                <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: meta.accent + '20', color: meta.accent }}
                >
                    {isActive
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Icon className="w-4 h-4" />
                    }
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {meta.name}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {meta.role}
                        </span>
                        {isActive && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full animate-pulse"
                                style={{ background: meta.accent + '20', color: meta.accent }}>
                                live
                            </span>
                        )}
                    </div>
                    {isDone && state.report && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            <ExpertEstimateChip value={state.report.probability} accent={meta.accent} compact />
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {getLikelihoodMeta(state.report.probability).label} · {state.articles.length} sources
                                {state.sqlDataPoints.length > 0 ? ` · ${state.sqlDataPoints.length} data` : ''}
                            </span>
                        </div>
                    )}
                    {isActive && state.searchQueries.length > 0 && (
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            Searching: {state.searchQueries[state.searchQueries.length - 1]?.query}
                        </p>
                    )}
                </div>
                {isDone && (
                    state.expanded
                        ? <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                        : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                )}
            </button>

            {/* Expanded content */}
            {state.expanded && isDone && state.report && (
                <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: 'var(--border-color)' }}>

                    {/* Reasoning */}
                    <div className="pt-3">
                        <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>REASONING</p>
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{state.report.reasoning}</p>
                    </div>

                    {/* Key Reasons */}
                    {state.report.keyReasons.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>KEY EVIDENCE</p>
                            <ul className="space-y-1">
                                {state.report.keyReasons.map((r, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: meta.accent }} />
                                        {r}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* SQL Data Points (Aryabhata only) */}
                    {state.sqlDataPoints.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                                <Database className="w-3 h-3" /> DATABASE EVIDENCE
                            </p>
                            <div className="space-y-1.5">
                                {state.sqlDataPoints.map((dp, i) => (
                                    <div key={i} className="rounded-lg p-2 text-xs" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                                        <p className="font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{dp.description}</p>
                                        <p style={{ color: 'var(--text-muted)' }}>{dp.result}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Articles */}
                    {state.articles.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                TOP SOURCES ({state.articles.length})
                            </p>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                {state.articles.slice(0, 12).map((a, i) => (
                                    <a
                                        key={i}
                                        href={a.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-start gap-2 rounded-lg p-2 text-xs group"
                                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                                    style={{ background: a.probabilitySignal > 0.1 ? '#52c49a' : a.probabilitySignal < -0.1 ? '#ef4444' : '#6b7280' }}
                                                />
                                                <span className="font-medium truncate group-hover:underline" style={{ color: 'var(--text-primary)' }}>
                                                    {a.title}
                                                </span>
                                            </div>
                                            <p className="truncate" style={{ color: 'var(--text-muted)' }}>{a.keyStatement}</p>
                                        </div>
                                        <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: meta.accent }} />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function DiscussionSection({ discussion, isRunning }: { discussion: DiscussionState; isRunning: boolean }) {
    if (discussion.rounds.length === 0 && !isRunning) return null

    return (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
                <MessageSquare className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Panel Discussion</span>
                {isRunning && discussion.rounds.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full animate-pulse"
                        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                        Round {discussion.currentRound}
                    </span>
                )}
            </div>
            <div className="p-4 space-y-4">
                {discussion.rounds.map(r => (
                    r.turns.map((turn, i) => {
                        const meta = AGENT_META[turn.agent]
                        return (
                            <div key={`${r.round}-${i}`} className="flex gap-2.5">
                                <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold"
                                    style={{ background: meta.accent + '20', color: meta.accent }}
                                >
                                    {meta.name[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="text-xs font-semibold" style={{ color: meta.accent }}>{meta.name}</span>
                                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Round {r.round}</span>
                                        {turn.probabilityAdjustment != null && (
                                            <span className="text-xs font-medium px-1 rounded" style={{ background: meta.accent + '15', color: meta.accent }}>
                                                → {turn.probabilityAdjustment}%
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{turn.text}</p>
                                </div>
                            </div>
                        )
                    })
                ))}
                {isRunning && discussion.rounds.length === 0 && (
                    <div className="flex items-center gap-2 py-2" style={{ color: 'var(--text-muted)' }}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-sm">Agents preparing their arguments...</span>
                    </div>
                )}
            </div>
        </div>
    )
}

function FinalResult({ result }: { result: FinalProbabilityResult }) {
    return (
        <div
            className="rounded-xl border-2 overflow-hidden"
            style={{ borderColor: 'var(--accent)', background: 'var(--bg-surface)' }}
        >
            <div className="flex items-center gap-2 px-5 py-3.5 border-b flex-wrap sm:gap-2.5" style={{ borderColor: 'var(--border-color)', background: 'var(--accent-bg)' }}>
                <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>Panel Verdict</span>
            </div>

            <div className="px-5 py-6 sm:px-6 sm:py-8 space-y-6 sm:space-y-8">
                <VerdictHero value={result.probability} confidence={result.confidence} />

                <div>
                    <p className="text-xs font-semibold tracking-wide mb-3 text-center sm:text-left" style={{ color: 'var(--text-muted)' }}>
                        HOW EACH EXPERT VOTED
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                        {(() => {
                            const entries = Object.entries(result.weightedBreakdown) as [
                                AgentName,
                                { probability: number; weight: number },
                            ][]
                            const totalWeight = entries.reduce((sum, [, d]) => sum + d.weight, 0)
                            return entries.map(([agent, data]) => {
                                const meta = AGENT_META[agent]
                                const weightPct =
                                    totalWeight > 0 ? Math.round((data.weight / totalWeight) * 100) : 0
                                return (
                                    <div
                                        key={agent}
                                        className="rounded-xl p-4 border"
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            borderColor: 'var(--border-subtle, var(--border-color))',
                                        }}
                                    >
                                        <div className="flex items-center gap-2 mb-3">
                                            <div
                                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                                style={{ background: meta.accent + '20', color: meta.accent }}
                                            >
                                                <meta.icon className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0 text-left">
                                                <p className="text-sm font-semibold" style={{ color: meta.accent }}>
                                                    {meta.name}
                                                </p>
                                                <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                                                    {meta.role}
                                                </p>
                                            </div>
                                        </div>
                                        <ExpertEstimateChip value={data.probability} accent={meta.accent} />
                                        <p
                                            className="text-[11px] mt-2.5 leading-snug"
                                            style={{ color: 'var(--text-muted)' }}
                                        >
                                            {weightPct}% influence on final verdict
                                        </p>
                                    </div>
                                )
                            })
                        })()}
                    </div>
                </div>

                {/* Reasoning */}
                <div className="pt-1">
                    <p className="text-xs font-semibold tracking-wide mb-2.5" style={{ color: 'var(--text-muted)' }}>CONSENSUS REASONING</p>
                    <p className="text-sm sm:text-[15px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>{result.reasoning}</p>
                </div>

                {/* Consensus + Conflict */}
                {result.consensusPoints.length > 0 && (
                    <div className="pt-1">
                        <p className="text-xs font-semibold tracking-wide mb-2.5" style={{ color: 'var(--text-muted)' }}>PANEL AGREED</p>
                        <ul className="space-y-2.5">
                            {result.consensusPoints.map((p, i) => (
                                <li key={i} className="flex items-start gap-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-emerald-500" />
                                    {p}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {result.conflictPoints.length > 0 && (
                    <div className="pt-1">
                        <p className="text-xs font-semibold tracking-wide mb-2.5" style={{ color: 'var(--text-muted)' }}>RESOLVED DISAGREEMENTS</p>
                        <ul className="space-y-2.5">
                            {result.conflictPoints.map((p, i) => (
                                <li key={i} className="flex items-start gap-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-amber-500" />
                                    {p}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExpertsChat() {
    const { theme } = useTheme()
    const isDark = theme === 'dark'
    const isClaude = theme === 'claude-code'
    const { data: session } = useSession()
    const router = useRouter()
    const pathname = usePathname() || ''

    const [query, setQuery] = useState('')
    const [userData, setUserData] = useState('')
    const [showUserData, setShowUserData] = useState(false)
    const [sessions, setSessions] = useState<ExpertsSession[]>([])
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [isMobile, setIsMobile] = useState(false)
    const [stockSearchOpen, setStockSearchOpen] = useState(false)
    const [sidebarAccountOpen, setSidebarAccountOpen] = useState(false)
    const [userBadge, setUserBadge] = useState<{ name: string; plan: string }>({ name: 'User', plan: 'Free Plan' })
    const [analysis, setAnalysis] = useState<AnalysisState>(emptyAnalysis())
    const [expertUsage, setExpertUsage] = useState<{ used: number; limit: number; remaining: number; resetsOn: string; period?: string } | null>(null)
    const [limitError, setLimitError] = useState<string | null>(null)

    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const accountSectionRef = useRef<HTMLDivElement>(null)

    // Load session list on mount
    useEffect(() => {
        fetch('/api/experts/sessions')
            .then(r => r.json())
            .then(d => setSessions(d.sessions || []))
            .catch(() => {})
    }, [])

    // Load expert usage on mount (only for logged-in users)
    useEffect(() => {
        if (!session?.user) return
        fetch('/api/user/usage')
            .then(r => r.json())
            .then(d => { if (d.success) setExpertUsage(d.data.experts) })
            .catch(() => {})
    }, [session?.user])

    useEffect(() => {
        fetch('/api/user/subscription', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
            .then((data) => {
                if (data?.plan) {
                    setUserBadge({
                        name: data.name ?? 'User',
                        plan: `${data.label || 'Free'} Plan`,
                    })
                }
            })
            .catch(() => {})
    }, [])

    useLayoutEffect(() => {
        const media = window.matchMedia('(max-width: 1023px)')
        const sync = () => {
            const mobile = media.matches
            setIsMobile(mobile)
            setSidebarOpen(!mobile)
        }
        sync()
        media.addEventListener('change', sync)
        return () => media.removeEventListener('change', sync)
    }, [])

    // Auto-scroll when content updates
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [analysis.agents, analysis.discussion, analysis.finalResult])

    const toggleAgent = useCallback((agent: AgentName) => {
        setAnalysis(prev => ({
            ...prev,
            agents: {
                ...prev.agents,
                [agent]: { ...prev.agents[agent], expanded: !prev.agents[agent].expanded },
            },
        }))
    }, [])

    const loadSession = useCallback(async (sessionId: string) => {
        try {
            const res = await fetch(`/api/experts/sessions/${sessionId}`)
            const { session: s } = await res.json()
            if (!s?.analyses?.length) return

            const latest = s.analyses[0]
            const k = latest.krishnaReport as AgentReport
            const c = latest.chanakyaReport as AgentReport
            const a = latest.aryabhataReport as AgentReport
            const disc = latest.discussionLog as any[]

            const rounds: { round: number; turns: DiscussionTurn[] }[] = []
            for (const turn of disc) {
                const existing = rounds.find(r => r.round === turn.round)
                if (existing) existing.turns.push(turn)
                else rounds.push({ round: turn.round, turns: [turn] })
            }

            setAnalysis({
                sessionId: s.id,
                query: s.query,
                agents: {
                    krishna: { status: 'done', searchQueries: k.searchQueries?.map((q: string, i: number) => ({ query: q, layer: i, label: q })) || [], articles: k.articles || [], sqlDataPoints: k.sqlDataPoints || [], report: k, expanded: false },
                    chanakya: { status: 'done', searchQueries: c.searchQueries?.map((q: string, i: number) => ({ query: q, layer: i, label: q })) || [], articles: c.articles || [], sqlDataPoints: c.sqlDataPoints || [], report: c, expanded: false },
                    aryabhata: { status: 'done', searchQueries: a.searchQueries?.map((q: string, i: number) => ({ query: q, layer: i, label: q })) || [], articles: a.articles || [], sqlDataPoints: a.sqlDataPoints || [], report: a, expanded: false },
                },
                discussion: { rounds, currentRound: 0 },
                finalResult: {
                    probability: latest.finalProbability,
                    confidence: latest.finalConfidence as any,
                    agentWeights: { krishna: k.confidence * 0.3, chanakya: c.confidence * 0.35, aryabhata: a.confidence * 0.35 },
                    weightedBreakdown: {
                        krishna: { probability: k.probability, weight: k.confidence * 0.3 },
                        chanakya: { probability: c.probability, weight: c.confidence * 0.35 },
                        aryabhata: { probability: a.probability, weight: a.confidence * 0.35 },
                    },
                    discussionLog: disc,
                    reasoning: latest.finalReasoning,
                    consensusPoints: [],
                    conflictPoints: [],
                },
                isRunning: false,
            })
            if (isMobile) setSidebarOpen(false)
        } catch {}
    }, [isMobile])

    const deleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        await fetch(`/api/experts/sessions/${sessionId}`, { method: 'DELETE' })
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        if (analysis.sessionId === sessionId) setAnalysis(emptyAnalysis())
    }, [analysis.sessionId])

    const closeSidebarMobile = useCallback(() => {
        if (isMobile) setSidebarOpen(false)
    }, [isMobile])

    const openAccountFromProfile = useCallback(() => {
        setSidebarAccountOpen(true)
        requestAnimationFrame(() => {
            accountSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        })
    }, [])

    const startNewAnalysis = useCallback(() => {
        setAnalysis(emptyAnalysis())
        setQuery('')
        closeSidebarMobile()
    }, [closeSidebarMobile])

    const runAnalysis = useCallback(async () => {
        if (!query.trim() || analysis.isRunning) return

        if (!session?.user?.id) {
            const returnTo = typeof window !== 'undefined'
                ? `${window.location.pathname}${window.location.search || ''}`
                : '/experts'
            const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/experts'
            router.replace(`/login?callbackUrl=${encodeURIComponent(safe)}`)
            return
        }

        abortRef.current?.abort()
        abortRef.current = new AbortController()

        const fresh = emptyAnalysis()
        fresh.query = query.trim()
        fresh.isRunning = true
        setAnalysis(fresh)

        setLimitError(null)
        try {
            const res = await fetch('/api/experts/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query.trim(),
                    userProvidedData: userData.trim() || undefined,
                    discussionRounds: 2,
                }),
                signal: abortRef.current.signal,
            })

            if (res.status === 429) {
                const errData = await res.json().catch(() => ({}))
                setLimitError(errData.message || 'Monthly limit reached. Please upgrade to Pro.')
                setAnalysis(prev => ({ ...prev, isRunning: false }))
                return
            }

            if (!res.body) throw new Error('No stream')
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split('\n\n')
                buffer = parts.pop() ?? ''

                for (const part of parts) {
                    const line = part.replace(/^data: /, '').trim()
                    if (!line) continue
                    try {
                        const event: ExpertsEvent = JSON.parse(line)
                        handleEvent(event)
                    } catch {}
                }
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return
            setAnalysis(prev => ({ ...prev, isRunning: false }))
        }
    }, [query, userData, analysis.isRunning])

    const handleEvent = useCallback((event: ExpertsEvent) => {
        setAnalysis(prev => {
            const next = { ...prev }

            switch (event.type) {
                case 'session_created':
                    next.sessionId = event.sessionId
                    setSessions(s => [{ id: event.sessionId, title: prev.query.slice(0, 60), query: prev.query, createdAt: new Date().toISOString() }, ...s])
                    break

                case 'agent_start':
                    next.agents = {
                        ...next.agents,
                        [event.agent]: { ...next.agents[event.agent], status: 'searching' },
                    }
                    break

                case 'agent_searching':
                    next.agents = {
                        ...next.agents,
                        [event.agent]: {
                            ...next.agents[event.agent],
                            searchQueries: [
                                ...next.agents[event.agent].searchQueries,
                                { query: event.searchQuery, layer: event.layer, label: event.layerLabel },
                            ],
                        },
                    }
                    break

                case 'agent_article':
                    next.agents = {
                        ...next.agents,
                        [event.agent]: {
                            ...next.agents[event.agent],
                            articles: [...next.agents[event.agent].articles, event.article],
                        },
                    }
                    break

                case 'agent_sql':
                    next.agents = {
                        ...next.agents,
                        aryabhata: {
                            ...next.agents.aryabhata,
                            sqlDataPoints: [...next.agents.aryabhata.sqlDataPoints, event.dataPoint],
                        },
                    }
                    break

                case 'agent_conclusion':
                    next.agents = {
                        ...next.agents,
                        [event.agent]: {
                            ...next.agents[event.agent],
                            status: 'done',
                            report: event.report,
                        },
                    }
                    break

                case 'discussion_start':
                    next.discussion = {
                        ...next.discussion,
                        currentRound: event.round,
                    }
                    break

                case 'discussion_point': {
                    const existing = next.discussion.rounds.find(r => r.round === event.round)
                    const turn: DiscussionTurn = { round: event.round, agent: event.agent, text: event.text }
                    if (existing) {
                        next.discussion = {
                            ...next.discussion,
                            rounds: next.discussion.rounds.map(r =>
                                r.round === event.round ? { ...r, turns: [...r.turns, turn] } : r
                            ),
                        }
                    } else {
                        next.discussion = {
                            ...next.discussion,
                            rounds: [...next.discussion.rounds, { round: event.round, turns: [turn] }],
                        }
                    }
                    break
                }

                case 'final_probability':
                    next.finalResult = event.result
                    next.isRunning = false
                    // Refresh usage count after successful analysis
                    fetch('/api/user/usage').then(r => r.json()).then(d => {
                        if (d.success) setExpertUsage(d.data.experts)
                    }).catch(() => {})
                    break

                case 'analysis_saved':
                    // refresh sidebar
                    fetch('/api/experts/sessions')
                        .then(r => r.json())
                        .then(d => setSessions(d.sessions || []))
                        .catch(() => {})
                    break

                case 'error':
                    next.isRunning = false
                    break
            }

            return next
        })
    }, [])

    const sidebarWordmarkStyle: CSSProperties = {
        backgroundImage: isDark
            ? 'linear-gradient(to right, #34d399, #22c55e)'
            : isClaude
                ? 'linear-gradient(to right, #d97757, #b4532a)'
                : 'linear-gradient(to right, #52a88c, #6bb89a)',
    }

    const navRowClass = (active: boolean) =>
        cn(
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors border border-transparent',
            active
                ? isDark
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                    : isClaude
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--border-color)]'
                        : 'bg-emerald-500/10 text-emerald-800 border-emerald-500/20'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]',
        )

    const settingsRowClass =
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'

    const hasContent = analysis.query !== '' || analysis.isRunning

    return (
        <div className="relative flex h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
            <StockSearchModal
                open={stockSearchOpen}
                onOpenChange={setStockSearchOpen}
                onAfterNavigate={closeSidebarMobile}
            />
            {isMobile && sidebarOpen && (
                <button
                    type="button"
                    className="absolute inset-0 z-30 bg-[var(--text-primary)]/25 backdrop-blur-[2px]"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close sidebar"
                />
            )}
            <div
                className={
                    isMobile
                        ? cn(
                            'fixed inset-y-0 left-0 z-40 flex h-full min-h-0 w-[min(18rem,85vw)] max-w-[85vw] flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out',
                            'pt-[max(0.5rem,env(safe-area-inset-top))]',
                            'pb-[env(safe-area-inset-bottom)]',
                            sidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none',
                        )
                        : cn(
                            'flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-surface)] transition-all duration-300',
                            sidebarOpen ? 'w-72' : 'w-0',
                        )
                }
            >
                <div className="shrink-0 space-y-2 border-b border-[var(--border-subtle)] p-3">
                    <Link
                        href="/stocks"
                        onClick={closeSidebarMobile}
                        className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--bg-secondary)]"
                    >
                        {isClaude && !isDark ? (
                            <svg viewBox="0 0 40 32" className="h-8 w-8 shrink-0" fill="none" aria-hidden>
                                <rect x="0" y="4" width="6" height="28" rx="1" fill="#d97757" />
                                <rect x="8" y="0" width="6" height="32" rx="1" fill="#c45a3c" />
                                <rect x="16" y="14" width="6" height="18" rx="1" fill="#e07a5f" />
                                <rect x="24" y="8" width="6" height="24" rx="1" fill="#b4532a" />
                                <rect x="32" y="2" width="6" height="30" rx="1" fill="#d97757" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 40 32" className="h-8 w-8 shrink-0" fill="none" aria-hidden>
                                <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
                                <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
                                <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
                                <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
                                <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
                            </svg>
                        )}
                        <span
                            className="bg-clip-text font-mono text-base font-black leading-none tracking-tight text-transparent sm:text-lg"
                            style={sidebarWordmarkStyle}
                        >
                            iStocks
                        </span>
                    </Link>

                    <button
                        type="button"
                        onClick={startNewAnalysis}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] py-2.5 font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-surface-hover)]"
                    >
                        <Plus className="h-4 w-4" /> New analysis
                    </button>

                    <button
                        type="button"
                        onClick={() => setStockSearchOpen(true)}
                        className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] py-2 pl-3 pr-3 text-left text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]"
                    >
                        <Search className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                        <span>Search stocks…</span>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                    <div className="database-chat-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-2">
                        <div className="pt-0.5">
                            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Menu
                            </p>
                            <nav className="flex flex-col gap-0.5" aria-label="Primary navigation">
                                {APP_NAV_ITEMS.map((item) => {
                                    const Icon = item.icon
                                    const isActive =
                                        item.url === '/experts'
                                            ? pathname === '/experts' || pathname.startsWith('/experts/')
                                            : item.url === '/database-chat'
                                                ? pathname === '/database-chat' || pathname.startsWith('/database-chat/')
                                                : pathname === item.url
                                    return (
                                        <Link
                                            key={item.url}
                                            href={item.url}
                                            onClick={closeSidebarMobile}
                                            className={navRowClass(isActive)}
                                        >
                                            <Icon className="h-4 w-4 shrink-0 opacity-80" />
                                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                            {item.badge ? (
                                                <span className="shrink-0 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                                                    {item.badge}
                                                </span>
                                            ) : null}
                                        </Link>
                                    )
                                })}
                            </nav>
                        </div>

                        <div ref={accountSectionRef} className="mt-2 border-t border-[var(--border-subtle)] pt-2">
                            <button
                                type="button"
                                aria-expanded={sidebarAccountOpen}
                                onClick={() => setSidebarAccountOpen((o) => !o)}
                                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    <User className="h-4 w-4 shrink-0 opacity-80" />
                                    Account
                                </span>
                                <ChevronDown
                                    className={cn('h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200', sidebarAccountOpen && 'rotate-180')}
                                    aria-hidden
                                />
                            </button>
                            {sidebarAccountOpen ? (
                                <div className="mt-1 flex flex-col gap-0.5 pb-1 pl-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            router.push('/pnl')
                                            closeSidebarMobile()
                                            setSidebarAccountOpen(false)
                                        }}
                                        className={settingsRowClass}
                                    >
                                        <BarChart3 className="h-4 w-4 shrink-0 opacity-80" />
                                        P&amp;L
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            window.dispatchEvent(new Event('istocks-open-llm-settings'))
                                            closeSidebarMobile()
                                            setSidebarAccountOpen(false)
                                        }}
                                        className={settingsRowClass}
                                    >
                                        <Bot className="h-4 w-4 shrink-0 opacity-80" />
                                        AI model
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            router.push('/trading/settings')
                                            closeSidebarMobile()
                                            setSidebarAccountOpen(false)
                                        }}
                                        className={settingsRowClass}
                                    >
                                        <Key className="h-4 w-4 shrink-0 opacity-80" />
                                        Broker keys
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            router.push('/account/usage')
                                            closeSidebarMobile()
                                            setSidebarAccountOpen(false)
                                        }}
                                        className={settingsRowClass}
                                    >
                                        <BarChart3 className="h-4 w-4 shrink-0 opacity-80" />
                                        Usage
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            window.dispatchEvent(new Event('istocks-open-appearance'))
                                            closeSidebarMobile()
                                            setSidebarAccountOpen(false)
                                        }}
                                        className={settingsRowClass}
                                    >
                                        <Palette className="h-4 w-4 shrink-0 opacity-80" />
                                        Appearance
                                    </button>
                                    {session?.user ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSidebarAccountOpen(false)
                                                signOut({ callbackUrl: '/' })
                                            }}
                                            className={cn(settingsRowClass, 'mt-0.5 text-red-600 dark:text-red-400')}
                                        >
                                            <LogOut className="h-4 w-4 shrink-0 opacity-80" />
                                            Sign out
                                        </button>
                                    ) : (
                                        <Link
                                            href="/login"
                                            onClick={() => {
                                                closeSidebarMobile()
                                                setSidebarAccountOpen(false)
                                            }}
                                            className={cn(settingsRowClass, 'text-[var(--accent)]')}
                                        >
                                            Sign in
                                        </Link>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                            <div className="sticky top-0 z-[1] -mx-2 mb-1 flex items-center gap-2 bg-[var(--bg-surface)] px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                                <History className="h-3 w-3" /> History
                            </div>
                            <div className="mt-1 space-y-1 px-1 pb-3">
                                {sessions.length === 0 && (
                                    <p className="px-2 py-2 text-xs text-[var(--text-muted)]">No analyses yet</p>
                                )}
                                {sessions.map((s) => (
                                    <div
                                        key={s.id}
                                        onClick={() => loadSession(s.id)}
                                        className={`group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-transparent px-3 py-2 text-sm transition-colors ${analysis.sessionId === s.id
                                            ? 'border-[var(--border-color)] bg-[var(--accent-bg)] text-[var(--text-primary)]'
                                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                                            }`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium">{s.title}</p>
                                            {s.analyses?.[0] && (() => {
                                                const p = clampPercent(s.analyses![0].finalProbability)
                                                const meta = getLikelihoodMeta(p)
                                                return (
                                                    <p className="mt-0.5 truncate text-[11px]">
                                                        <span className="font-semibold tabular-nums" style={{ color: meta.color }}>
                                                            {p}% chance
                                                        </span>
                                                        <span className="text-[var(--text-muted)]"> · {meta.label}</span>
                                                    </p>
                                                )
                                            })()}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => deleteSession(s.id, e)}
                                            className="rounded-lg p-1 opacity-0 transition-all hover:bg-[var(--bg-surface-hover)] group-hover:opacity-100"
                                            aria-label="Delete analysis"
                                        >
                                            <Trash2 className="h-3 w-3 text-[var(--text-muted)]" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-t border-[var(--border-subtle)] px-2 py-2">
                    <button
                        type="button"
                        onClick={openAccountFromProfile}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
                        aria-label="Open account menu"
                    >
                        <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
                            style={{ background: 'var(--accent)' }}
                        >
                            {userBadge.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--text-primary)]">{userBadge.name}</p>
                            <p className="truncate text-xs text-[var(--text-muted)]">{userBadge.plan}</p>
                        </div>
                    </button>
                </div>
            </div>

            {!isMobile && (
                <button
                    type="button"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className={cn(
                        'absolute top-1/2 z-10 -translate-y-1/2 rounded-r-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-1.5 text-[var(--text-muted)] shadow-[var(--shadow-sm)] transition-all hover:text-[var(--text-primary)]',
                        sidebarOpen ? 'left-72' : 'left-0',
                    )}
                    aria-expanded={sidebarOpen}
                    aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                >
                    {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
            )}

            {isMobile && !sidebarOpen && (
                <header
                    className="absolute left-0 right-0 top-0 z-50 flex items-center justify-center border-b px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
                    style={{
                        borderColor: 'var(--border-subtle)',
                        background: 'var(--bg-primary)',
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        className="absolute left-2 top-0 flex h-full items-center touch-manipulation rounded-lg px-2 text-[var(--text-secondary)] active:bg-[var(--bg-secondary)]"
                        aria-label="Open sidebar"
                    >
                        <PanelLeft className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-2 pr-2">
                        <div
                            className="flex h-8 w-8 items-center justify-center rounded-lg"
                            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                        >
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Experts
                        </span>
                    </div>
                </header>
            )}

            <div className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
                <div
                    className={cn(
                        'flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden',
                        isMobile && !sidebarOpen && 'pt-[max(4.25rem,env(safe-area-inset-top)+3rem)]',
                    )}
                >
                    <div className="database-chat-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y">
                        {!hasContent ? (
                            isMobile ? (
                                <div className="flex min-h-full flex-col justify-end px-4 pb-2 pt-4">
                                    <p className="mb-4 max-w-lg text-center text-[15px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                        Three AI agents research and debate to produce a panel probability — ask anything about markets or outcomes.
                                    </p>
                                    <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                                        Try asking
                                    </p>
                                    <div className="flex flex-col gap-0.5 pb-2">
                                        {EXPERT_EMPTY_SUGGESTIONS.map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onClick={() => setQuery(suggestion)}
                                                className="flex w-full touch-manipulation items-start gap-3 rounded-xl py-3.5 pl-1 pr-2 text-left transition-colors active:bg-[var(--bg-secondary)]"
                                            >
                                                <Sparkles
                                                    className="mt-0.5 h-5 w-5 shrink-0 opacity-70"
                                                    style={{ color: 'var(--accent)' }}
                                                />
                                                <span className="text-[15px] leading-snug" style={{ color: 'var(--text-primary)' }}>
                                                    {suggestion}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                            <div className="flex min-h-[50dvh] flex-col items-center justify-center px-3 py-8 pb-12 text-center sm:px-4">
                                <div
                                    className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                                >
                                    <Sparkles className="h-7 w-7" />
                                </div>
                                <h2 className="mb-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Experts Panel</h2>
                                <p className="mb-6 max-w-md text-sm" style={{ color: 'var(--text-muted)' }}>
                                    Ask any probability question. Three specialized AI agents — Krishna (historical), Chanakya (current news), and Aryabhata (numerical data) — will research independently and debate to reach a final probability.
                                </p>
                                <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    3-agent probability panel
                                </p>
                                <div className="grid w-full max-w-md grid-cols-1 gap-2">
                                    {EXPERT_EMPTY_SUGGESTIONS.map((suggestion) => (
                                        <button
                                            key={suggestion}
                                            type="button"
                                            onClick={() => setQuery(suggestion)}
                                            className="touch-manipulation rounded-xl border px-4 py-3 text-left text-sm transition-colors active:bg-[var(--bg-secondary)]"
                                            style={{
                                                color: 'var(--text-secondary)',
                                                borderColor: 'var(--border-color)',
                                                background: 'var(--bg-surface)',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = 'var(--accent)'
                                                e.currentTarget.style.color = 'var(--text-primary)'
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = 'var(--border-color)'
                                                e.currentTarget.style.color = 'var(--text-secondary)'
                                            }}
                                        >
                                            {suggestion}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            )
                        ) : (
                            <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 pb-32 sm:space-y-8 sm:px-6 sm:py-8 sm:pb-24">
                                <div className="space-y-2 pb-2">
                                    <p className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>QUESTION</p>
                                    <p className="text-base sm:text-lg font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>{analysis.query}</p>
                                </div>

                                <div className="space-y-3 md:space-y-4">
                                    {(Object.keys(AGENT_META) as AgentName[]).map(agent => (
                                        <AgentCard
                                            key={agent}
                                            name={agent}
                                            state={analysis.agents[agent]}
                                            onToggle={() => toggleAgent(agent)}
                                        />
                                    ))}
                                </div>

                                <DiscussionSection
                                    discussion={analysis.discussion}
                                    isRunning={analysis.isRunning && analysis.agents.aryabhata.status === 'done'}
                                />

                                {analysis.finalResult && <FinalResult result={analysis.finalResult} />}

                                <div ref={bottomRef} />
                            </div>
                        )}
                    </div>

                    <div
                        className={cn(
                            'flex-shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]',
                            isMobile
                                ? 'border-0 bg-[var(--bg-primary)] pt-2'
                                : 'border-t border-[var(--border-color)] bg-[var(--bg-surface)] pt-4 sm:pt-5',
                        )}
                    >
                        <div className="mx-auto max-w-3xl space-y-3">
                            <div className={cn('flex flex-wrap items-center justify-between gap-x-2 gap-y-1', isMobile && 'text-[10px]')}>
                                <div className={cn('flex items-center gap-1.5 text-[var(--text-muted)]', isMobile ? 'text-[10px]' : 'text-[11px]')}>
                                    <Sparkles className={cn('text-purple-400', isMobile ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
                                    <span className="font-medium text-[var(--text-primary)]">Compute 1.0</span>
                                    {session?.user && expertUsage && (
                                        <span className="ml-1">
                                            · {expertUsage.used}/{expertUsage.limit}{' '}
                                            {expertUsage.period === 'subscription' ? 'this Pro period' : 'this month'}
                                        </span>
                                    )}
                                </div>
                                {session?.user && expertUsage && expertUsage.remaining <= 2 && (
                                    <Link href="/pricing" className={cn('text-amber-500 font-medium hover:underline', isMobile ? 'text-[10px]' : 'text-[11px]')}>
                                        {expertUsage.remaining === 0 ? 'Limit reached · Upgrade' : `${expertUsage.remaining} left · Upgrade`}
                                    </Link>
                                )}
                            </div>

                            {limitError && (
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-500">
                                    <span>{limitError}</span>
                                    <Link href="/pricing" className="shrink-0 font-semibold underline underline-offset-2">Upgrade</Link>
                                </div>
                            )}

                            {isMobile ? (
                                <>
                                    {showUserData && (
                                        <textarea
                                            value={userData}
                                            onChange={e => setUserData(e.target.value)}
                                            placeholder="Optional context or numbers for the panel…"
                                            rows={3}
                                            className="w-full resize-none rounded-2xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-subtle)',
                                                color: 'var(--text-primary)',
                                            }}
                                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
                                        />
                                    )}
                                    <div
                                        className="flex min-h-[52px] items-end gap-0.5 rounded-[28px] border py-1 pl-1.5 pr-1"
                                        style={{
                                            background: 'var(--bg-secondary)',
                                            borderColor: 'var(--border-subtle)',
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setShowUserData(p => !p)}
                                            aria-label={showUserData ? 'Hide optional data' : 'Add optional data'}
                                            className={cn(
                                                'mb-0.5 flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-colors',
                                                showUserData
                                                    ? 'text-[var(--accent)]'
                                                    : 'text-[var(--text-secondary)] active:bg-[var(--bg-primary)]',
                                            )}
                                        >
                                            <Plus className="h-6 w-6" strokeWidth={2} />
                                        </button>
                                        <input
                                            type="text"
                                            value={query}
                                            onChange={e => setQuery(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) runAnalysis() }}
                                            placeholder="Ask anything"
                                            disabled={analysis.isRunning}
                                            className="mb-0.5 min-h-[44px] min-w-0 flex-1 touch-manipulation border-0 bg-transparent py-2.5 pl-0.5 pr-2 text-[16px] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60"
                                            style={{ color: 'var(--text-primary)' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={runAnalysis}
                                            disabled={!query.trim() || analysis.isRunning}
                                            aria-label={analysis.isRunning ? 'Analysing' : 'Send'}
                                            className="mb-0.5 flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                                            style={{
                                                background: query.trim() && !analysis.isRunning ? 'var(--accent)' : 'var(--text-muted)',
                                                color: '#fff',
                                            }}
                                        >
                                            {analysis.isRunning
                                                ? <Loader2 className="h-5 w-5 animate-spin" />
                                                : <Send className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setShowUserData(p => !p)}
                                        className="flex items-center gap-1 text-xs transition-colors"
                                        style={{ color: showUserData ? 'var(--accent)' : 'var(--text-muted)' }}
                                    >
                                        <Database className="h-3 w-3" />
                                        {showUserData ? 'Hide' : 'Add'} your own data (optional)
                                    </button>

                                    {showUserData && (
                                        <textarea
                                            value={userData}
                                            onChange={e => setUserData(e.target.value)}
                                            placeholder="Paste any data, numbers, or context you want Aryabhata to use..."
                                            rows={2}
                                            className="w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-2"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-color)',
                                                color: 'var(--text-primary)',
                                            }}
                                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                                        />
                                    )}

                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                                        <input
                                            type="text"
                                            value={query}
                                            onChange={e => setQuery(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) runAnalysis() }}
                                            placeholder="Ask a probability question — e.g. Will WIPRO close above ₹300 this week?"
                                            disabled={analysis.isRunning}
                                            className="min-w-0 w-full flex-1 touch-manipulation rounded-xl border px-4 py-3 text-base outline-none transition-colors focus:ring-2 sm:py-2.5 sm:text-sm"
                                            style={{
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-color)',
                                                color: 'var(--text-primary)',
                                            }}
                                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={runAnalysis}
                                            disabled={!query.trim() || analysis.isRunning}
                                            className="flex w-full shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
                                            style={{ background: 'var(--accent)', color: '#fff' }}
                                        >
                                            {analysis.isRunning
                                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                                : <Send className="h-4 w-4" />}
                                            {analysis.isRunning ? 'Analysing...' : 'Analyse'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
