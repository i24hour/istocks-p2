'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Play, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'

type ConversationTurn = {
  role: 'user' | 'assistant'
  content: string
}

type IterationCase = {
  id: string
  source: 'web' | 'telegram'
  mode: 'trading-agent' | 'stock-ai'
  userLabel: string
  stockSymbol: string | null
  createdAt: string
  prompt: string
  reply: string
  history: ConversationTurn[]
  dissatisfiedFollowUp: boolean
  dissatisfiedReason: string | null
}

type IterationReplayResult = {
  caseId: string
  source: 'web' | 'telegram'
  mode: 'trading-agent' | 'stock-ai'
  prompt: string
  oldReply: string
  newReply: string
  userLabel: string
  stockSymbol: string | null
  createdAt: string
  dissatisfiedFollowUp: boolean
  dissatisfiedReason: string | null
  status: 'pass' | 'warning' | 'fail'
  score: number
  improved: boolean
  flags: string[]
}

type IterationRecommendation = {
  key: string
  area: 'system_prompt' | 'routing' | 'response_handling' | 'function_logic'
  priority: 'high' | 'medium' | 'low'
  title: string
  reason: string
  suggestedChange: string
  evidenceCount: number
  samplePrompts: string[]
}

type IterationReplaySummary = {
  total: number
  pass: number
  warning: number
  fail: number
  improved: number
  dissatisfiedCases: number
  recommendations: IterationRecommendation[]
}

export default function IterationPage() {
  const { status } = useSession()
  const router = useRouter()
  const [cases, setCases] = useState<IterationCase[]>([])
  const [results, setResults] = useState<IterationReplayResult[]>([])
  const [summary, setSummary] = useState<IterationReplaySummary | null>(null)
  const [loadingCases, setLoadingCases] = useState(true)
  const [running, setRunning] = useState(false)
  const [limit, setLimit] = useState(15)
  const [autoRun, setAutoRun] = useState(false)
  const [refreshSeconds, setRefreshSeconds] = useState(60)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/iteration')
    }
  }, [router, status])

  const loadCases = async () => {
    setLoadingCases(true)
    try {
      const response = await fetch(`/api/iteration/cases?limit=${limit}`, { cache: 'no-store' })
      const data = await response.json()
      if (data.success) {
        setCases(data.data)
        return data.data as IterationCase[]
      }
      return [] as IterationCase[]
    } finally {
      setLoadingCases(false)
    }
  }

  useEffect(() => {
    if (status === 'authenticated') {
      loadCases()
    }
  }, [status, limit])

  const runReplay = async (caseList = cases) => {
    if (caseList.length === 0) {
      setResults([])
      setSummary(null)
      return
    }

    setRunning(true)
    try {
      const response = await fetch('/api/iteration/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases: caseList, limit }),
      })
      const data = await response.json()
      if (data.success) {
        setResults(data.results)
        setSummary(data.summary)
      }
    } finally {
      setRunning(false)
    }
  }

  const counters = useMemo(() => ({
    total: summary?.total ?? results.length,
    pass: summary?.pass ?? results.filter((item) => item.status === 'pass').length,
    warning: summary?.warning ?? results.filter((item) => item.status === 'warning').length,
    fail: summary?.fail ?? results.filter((item) => item.status === 'fail').length,
    improved: summary?.improved ?? results.filter((item) => item.improved).length,
  }), [results, summary])

  useEffect(() => {
    if (!autoRun || status !== 'authenticated') return

    let cancelled = false

    const runCycle = async () => {
      if (cancelled) return
      const latestCases = await loadCases()
      if (cancelled || latestCases.length === 0) return
      await runReplay(latestCases)
    }

    void runCycle()
    const interval = window.setInterval(runCycle, Math.max(15, refreshSeconds) * 1000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [autoRun, refreshSeconds, status, limit])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-dark-200 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-200 text-white">
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Iteration Review</h1>
            <p className="text-sm text-gray-400 mt-1">Replay historical prompts from all users and inspect weak replies.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-300 flex items-center gap-2">
              Limit
              <input
                type="number"
                min={1}
                max={25}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                className="w-20 rounded-lg border border-white/10 bg-dark-300 px-3 py-2 text-white outline-none"
              />
            </label>
            <button
              onClick={() => { void loadCases() }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-dark-300/60 px-4 py-2 text-sm text-gray-200 hover:bg-dark-300"
              type="button"
            >
              <RefreshCw className="w-4 h-4" /> Reload Cases
            </button>
            <button
              onClick={() => { void runReplay() }}
              disabled={running || loadingCases || cases.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              type="button"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Replay Latest {Math.min(limit, cases.length || limit)}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-300">Autonomous Iteration Mode</p>
              <p className="mt-1 text-sm text-gray-300">Latest prompts are reloaded and replayed automatically. This review loop only scores answers and suggests improvements. It does not auto-edit code, push backend changes, or deploy the site.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-gray-300 flex items-center gap-2">
                Every
                <input
                  type="number"
                  min={15}
                  max={600}
                  value={refreshSeconds}
                  onChange={(e) => setRefreshSeconds(Math.max(15, Math.min(600, Number(e.target.value) || 15)))}
                  className="w-20 rounded-lg border border-white/10 bg-dark-300 px-3 py-2 text-white outline-none"
                />
                sec
              </label>
              <button
                onClick={() => setAutoRun((prev) => !prev)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${autoRun ? 'bg-red-500/15 text-red-200 border border-red-500/30' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                type="button"
              >
                {autoRun ? 'Stop Auto-Run' : 'Start Auto-Run'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Loaded Cases</p>
            <p className="text-2xl font-semibold">{loadingCases ? '...' : cases.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Pass</p>
            <p className="text-2xl font-semibold text-emerald-400">{counters.pass}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Warning</p>
            <p className="text-2xl font-semibold text-amber-300">{counters.warning}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Fail</p>
            <p className="text-2xl font-semibold text-red-400">{counters.fail}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Improved vs Old Reply</p>
            <p className="text-2xl font-semibold text-blue-300">{counters.improved}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-dark-300/40 p-4">
            <p className="text-xs uppercase text-gray-500">Recommendation Count</p>
            <p className="text-2xl font-semibold text-white">{summary?.recommendations.length ?? 0}</p>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <h2 className="text-lg font-semibold">Suggested Improvements</h2>
          </div>
          {summary?.recommendations.length ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {summary.recommendations.map((recommendation) => (
                <div key={recommendation.key} className="rounded-xl border border-white/10 bg-dark-300/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2.5 py-1 ${recommendation.priority === 'high' ? 'bg-red-500/15 text-red-300' : recommendation.priority === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-blue-300'}`}>
                      {recommendation.priority.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-gray-300">{recommendation.area}</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-gray-300">{recommendation.evidenceCount} cases</span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">{recommendation.title}</h3>
                    <p className="mt-1 text-sm text-gray-300">{recommendation.reason}</p>
                  </div>
                  <p className="text-sm text-emerald-200">{recommendation.suggestedChange}</p>
                  {recommendation.samplePrompts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs uppercase text-gray-500">Sample prompts</p>
                      {recommendation.samplePrompts.map((prompt) => (
                        <div key={prompt} className="rounded-lg bg-black/10 px-3 py-2 text-sm text-gray-300">{prompt}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-dark-300/30 p-6 text-gray-400">Run replay to generate system-prompt, routing, and handler improvement suggestions.</div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-gray-400" />
            <h2 className="text-lg font-semibold">Historical Cases</h2>
          </div>
          <div className="space-y-3">
            {loadingCases ? (
              <div className="rounded-xl border border-white/10 bg-dark-300/30 p-6 text-gray-400">Loading cases...</div>
            ) : cases.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-dark-300/30 p-6 text-gray-400">No replayable cases found.</div>
            ) : (
              cases.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-dark-300/30 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-2">
                    <span>{item.source}</span>
                    <span>•</span>
                    <span>{item.mode}</span>
                    <span>•</span>
                    <span>{item.userLabel}</span>
                    {item.stockSymbol && <><span>•</span><span>{item.stockSymbol}</span></>}
                  </div>
                  <p className="text-sm text-white"><span className="text-gray-400">Prompt:</span> {item.prompt}</p>
                  <p className="text-sm text-gray-300 mt-2"><span className="text-gray-500">Old reply:</span> {item.reply.slice(0, 280)}{item.reply.length > 280 ? '...' : ''}</p>
                  {item.dissatisfiedFollowUp && item.dissatisfiedReason && (
                    <p className="text-xs text-amber-300 mt-2">Historical dissatisfaction: {item.dissatisfiedReason}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <h2 className="text-lg font-semibold">Replay Results</h2>
          </div>
          <div className="space-y-4">
            {results.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-dark-300/30 p-6 text-gray-400">Run replay to generate review results.</div>
            ) : (
              results.map((result) => (
                <div key={result.caseId} className="rounded-xl border border-white/10 bg-dark-300/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2.5 py-1 ${result.status === 'pass' ? 'bg-emerald-500/15 text-emerald-300' : result.status === 'warning' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>
                        {result.status.toUpperCase()} · {result.score}
                      </span>
                      {result.improved && <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-blue-300">Improved</span>}
                      {result.dissatisfiedFollowUp && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">User was dissatisfied</span>}
                    </div>
                    <div className="text-xs text-gray-400">{result.userLabel}</div>
                  </div>
                  <p className="text-sm text-white"><span className="text-gray-400">Prompt:</span> {result.prompt}</p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> Old reply</div>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{result.oldReply}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2"><CheckCircle2 className="w-3.5 h-3.5" /> Replay reply</div>
                      <p className="text-sm text-gray-100 whitespace-pre-wrap">{result.newReply}</p>
                    </div>
                  </div>
                  {result.flags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {result.flags.map((flag) => (
                        <span key={flag} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-300">{flag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}