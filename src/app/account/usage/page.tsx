'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, MessageSquare, Crown, RefreshCw, ArrowLeft, Paperclip, Calendar } from 'lucide-react'

interface UsageData {
    plan: 'free' | 'pro'
    subscription: {
        plan: 'free' | 'pro'
        expiresAt: string | null
        startedAt: string | null
        daysRemaining: number | null
    }
    prompts: {
        used: number
        limit: number
        remaining: number
        period: string
    }
    experts: {
        used: number
        limit: number
        remaining: number
        resetsOn: string
        period: string
        model: string
    }
    attachments: {
        available: boolean
        used: number
        limit: number
        remaining: number
        resetsOn: string
        period: string
    }
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
    const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
    const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-[var(--accent)]'
    return (
        <div className="h-2 w-full rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        </div>
    )
}

function formatPlanDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

export default function UsagePage() {
    const { status } = useSession()
    const router = useRouter()
    const [usage, setUsage] = useState<UsageData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (status === 'unauthenticated') { router.push('/login'); return }
        if (status !== 'authenticated') return

        fetch('/api/user/usage')
            .then(r => r.json())
            .then(d => { if (d.success) setUsage(d.data) })
            .finally(() => setLoading(false))
    }, [status, router])

    const isPro = usage?.plan === 'pro'
    const expiresAt = usage?.subscription.expiresAt
    const expertsPeriodLabel = usage?.experts.period === 'subscription'
        ? 'Per 30-day Pro period · Compute 1.0'
        : 'Resets monthly (1st) · Compute 1.0'
    const expertsRemainingLabel = usage?.experts.period === 'subscription'
        ? 'remaining this Pro period'
        : 'remaining this month'
    const expertsResetsLabel = usage?.experts.period === 'subscription'
        ? 'Resets when Pro renews'
        : 'Resets'
    const attachPeriodLabel = usage?.attachments.period === 'subscription'
        ? 'Excel, PDF, image · Per Pro period'
        : 'Excel, PDF, image · Resets monthly (1st)'
    const attachRemainingLabel = usage?.attachments.period === 'subscription'
        ? 'remaining this Pro period'
        : 'remaining this month'

    return (
        <div className="min-h-screen bg-[var(--bg-primary)]">
            <main className="max-w-2xl mx-auto px-4 py-10">
                <Link href="/database-chat" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to chat
                </Link>

                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Usage</h1>
                    {isPro && (
                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 text-amber-500 text-xs font-semibold">
                            <Crown className="w-3.5 h-3.5" />
                            Pro Plan
                        </span>
                    )}
                </div>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                    Track your AI analysis consumption. Powered by <span className="font-medium text-[var(--text-primary)]">Compute 1.0</span>.
                </p>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <RefreshCw className="w-6 h-6 animate-spin text-[var(--accent)]" />
                    </div>
                ) : !usage ? (
                    <p className="text-sm text-[var(--text-muted)]">Could not load usage data.</p>
                ) : (
                    <div className="space-y-4">
                        <div className={`rounded-2xl border p-5 ${
                            isPro
                                ? 'border-amber-500/30 bg-amber-500/5'
                                : 'border-[var(--border-subtle)] bg-[var(--card-bg)]'
                        }`}>
                            <div className="flex items-start gap-3">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                    isPro ? 'bg-amber-500/15' : 'bg-[var(--bg-secondary)]'
                                }`}>
                                    <Calendar className={`w-4.5 h-4.5 ${isPro ? 'text-amber-500' : 'text-[var(--text-muted)]'}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                                        {isPro ? 'Pro membership' : 'Free plan'}
                                    </p>
                                    {isPro && expiresAt ? (
                                        <>
                                            <p className="text-sm text-[var(--text-primary)] mt-1">
                                                Ends on <span className="font-medium">{formatPlanDate(expiresAt)}</span>
                                                {usage.subscription.daysRemaining != null && (
                                                    <span className="text-[var(--text-muted)]">
                                                        {' '}· {usage.subscription.daysRemaining} day{usage.subscription.daysRemaining === 1 ? '' : 's'} left
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                                Renew from Pricing before this date to keep Pro benefits.
                                            </p>
                                        </>
                                    ) : isPro ? (
                                        <p className="text-xs text-[var(--text-muted)] mt-1">Active Pro — renewal date will appear after your next billing cycle.</p>
                                    ) : (
                                        <p className="text-xs text-[var(--text-muted)] mt-1">
                                            No end date on Free. Upgrade to Pro for file attachments, 50 Experts analyses/month, and unlimited chat.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-5">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                                        <MessageSquare className="w-4.5 h-4.5 text-blue-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">AI Chat Prompts</p>
                                        <p className="text-xs text-[var(--text-muted)]">Resets daily · Compute 1.0</p>
                                    </div>
                                </div>
                                <p className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                                    {usage.prompts.used}
                                    <span className="text-[var(--text-muted)] font-normal"> / {isPro ? '∞' : usage.prompts.limit}</span>
                                </p>
                            </div>
                            {!isPro && <UsageBar used={usage.prompts.used} limit={usage.prompts.limit} />}
                            {!isPro && (
                                <p className="text-xs text-[var(--text-muted)] mt-2">
                                    {usage.prompts.remaining} remaining today
                                </p>
                            )}
                            {isPro && <p className="text-xs text-emerald-500 font-medium">Unlimited on Pro</p>}
                        </div>

                        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-5">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-xl bg-teal-500/10 flex items-center justify-center">
                                        <Paperclip className="w-4.5 h-4.5 text-teal-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">File attachments</p>
                                        <p className="text-xs text-[var(--text-muted)]">{attachPeriodLabel}</p>
                                    </div>
                                </div>
                                <p className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                                    {usage.attachments.available
                                        ? (
                                            <>
                                                {usage.attachments.used}
                                                <span className="text-[var(--text-muted)] font-normal"> / {usage.attachments.limit}</span>
                                            </>
                                        )
                                        : <span className="text-[var(--text-muted)] font-normal text-xs">Not available</span>}
                                </p>
                            </div>
                            {usage.attachments.available ? (
                                <>
                                    <UsageBar used={usage.attachments.used} limit={usage.attachments.limit} />
                                    <div className="flex items-center justify-between mt-2">
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {usage.attachments.remaining} {attachRemainingLabel}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {usage.attachments.period === 'subscription' ? expertsResetsLabel : 'Resets'} {formatPlanDate(usage.attachments.resetsOn)}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <p className="text-xs text-[var(--text-muted)]">
                                    Pro only — up to 5 file attachments per 30-day Pro period.
                                </p>
                            )}
                        </div>

                        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-5">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
                                        <Sparkles className="w-4.5 h-4.5 text-purple-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">Experts Analysis</p>
                                        <p className="text-xs text-[var(--text-muted)]">{expertsPeriodLabel}</p>
                                    </div>
                                </div>
                                <p className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                                    {usage.experts.used}
                                    <span className="text-[var(--text-muted)] font-normal"> / {usage.experts.limit}</span>
                                </p>
                            </div>
                            <UsageBar used={usage.experts.used} limit={usage.experts.limit} />
                            <div className="flex items-center justify-between mt-2">
                                <p className="text-xs text-[var(--text-muted)]">
                                    {usage.experts.remaining} {expertsRemainingLabel}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {expertsResetsLabel} {formatPlanDate(usage.experts.resetsOn)}
                                </p>
                            </div>
                        </div>

                        {!isPro && (
                            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">Upgrade to Pro</p>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        50 Experts per 30-day Pro period, 5 attachments per period, unlimited chat.
                                    </p>
                                </div>
                                <Link
                                    href="/pricing"
                                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity"
                                >
                                    <Crown className="w-3.5 h-3.5" />
                                    Upgrade
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    )
}
