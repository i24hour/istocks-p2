'use client'

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
    CheckCircle2,
    Sparkles,
    Zap,
    TrendingUp,
    Shield,
    Loader2,
    Crown,
    ArrowRight,
    BadgeCheck,
    Phone,
    Unlock,
    Paperclip,
} from 'lucide-react'
import { useTheme, type ThemeMode } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'

function proCardChrome(theme: ThemeMode): CSSProperties {
    if (theme === 'dark') {
        return {
            background: 'linear-gradient(145deg,#0f2722 0%,#0a1f1b 100%)',
            border: '1.5px solid #34d399',
            boxShadow: '0 0 40px rgba(52,211,153,0.12)',
        }
    }
    if (theme === 'claude-code') {
        return {
            background: 'linear-gradient(145deg, #fdf8f4 0%, #efeae3 100%)',
            border: '1.5px solid var(--accent)',
            boxShadow: '0 8px 32px rgba(217, 119, 87, 0.16)',
        }
    }
    return {
        background: 'linear-gradient(145deg,#ecfdf5 0%,#d1fae5 100%)',
        border: '1.5px solid var(--accent)',
        boxShadow: '0 0 40px rgba(82, 168, 140, 0.12)',
    }
}

function cornerBadgeBackground(isPro: boolean, theme: ThemeMode): string {
    if (theme === 'claude-code') {
        return isPro
            ? 'linear-gradient(90deg,#b4532a,#d97757)'
            : 'linear-gradient(90deg,#d97757,#c96a4d)'
    }
    if (theme === 'dark') {
        return isPro
            ? 'linear-gradient(90deg,#0d9488,#14b8a6)'
            : 'linear-gradient(90deg,#34d399,#52c49a)'
    }
    return isPro
        ? 'linear-gradient(90deg,#449a7f,#52a88c)'
        : 'linear-gradient(90deg,#52a88c,#6bb89a)'
}

function subscribeButtonBackground(loading: boolean, theme: ThemeMode): CSSProperties {
    if (loading) return { background: '#6b7280', boxShadow: 'none' }
    if (theme === 'claude-code') {
        return {
            background: 'linear-gradient(90deg,#c96a4d,#d97757)',
            boxShadow: '0 4px 20px rgba(217, 119, 87, 0.35)',
        }
    }
    if (theme === 'dark') {
        return {
            background: 'linear-gradient(90deg,#34d399,#52c49a)',
            boxShadow: '0 4px 20px rgba(52,211,153,0.3)',
        }
    }
    return {
        background: 'linear-gradient(90deg,#52a88c,#6bb89a)',
        boxShadow: '0 4px 20px rgba(82, 168, 140, 0.28)',
    }
}

function proMemberStatusBox(theme: ThemeMode): CSSProperties {
    if (theme === 'claude-code') {
        return {
            background: 'rgba(217, 119, 87, 0.12)',
            color: 'var(--accent)',
            border: '1px solid rgba(217, 119, 87, 0.35)',
        }
    }
    if (theme === 'dark') {
        return {
            background: 'rgba(52,211,153,0.12)',
            color: '#34d399',
            border: '1px solid rgba(52,211,153,0.3)',
        }
    }
    return {
        background: 'rgba(82, 168, 140, 0.1)',
        color: 'var(--accent)',
        border: '1px solid rgba(82, 168, 140, 0.28)',
    }
}

// ── Razorpay Checkout.js ─────────────────────────────────────────────────────

declare global {
    interface Window {
        Razorpay: new (options: Record<string, unknown>) => {
            open: () => void
            on: (event: string, handler: (response: unknown) => void) => void
        }
    }
}

/** Parse JSON from a fetch Response; never throws on empty body. */
async function readJsonResponse<T>(res: Response): Promise<T | null> {
    const text = await res.text()
    const trimmed = text.trim()
    if (!trimmed) return null
    try {
        return JSON.parse(trimmed) as T
    } catch {
        throw new Error(`Server returned invalid response (${res.status}). Try again or contact support.`)
    }
}

function loadRazorpayScript(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve()
    if (window.Razorpay) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://checkout.razorpay.com/v1/checkout.js'
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Razorpay checkout'))
        document.body.appendChild(script)
    })
}

// ── Plan data ────────────────────────────────────────────────────────────────

const PRO_FEATURES = [
    { icon: Sparkles,   text: '50 Experts analyses per 30-day Pro period (Compute 1.0)' },
    { icon: Sparkles,   text: 'Unlimited AI chat analysis via Compute 1.0' },
    { icon: Paperclip,  text: '5 file attachments per Pro period (Excel, PDF, image)' },
    { icon: TrendingUp, text: '₹1 Crore paper trading limit' },
    { icon: Shield,     text: 'Priority response & no rate limits' },
    { icon: Zap,        text: 'All current & future Pro features' },
]

const FREE_FEATURES = [
    { text: 'Stock analysis & charts' },
    { text: 'Paper trading (₹10 Lakh limit)' },
    { text: 'Telegram bot integration' },
    { text: 'Sangraha strategy marketplace' },
    { text: '10 AI chat prompts/day via Compute 1.0' },
    { text: '3 Experts analyses/month via Compute 1.0 (resets 1st)' },
]

// ── Component ────────────────────────────────────────────────────────────────

export default function PricingPage() {
    const { data: session, status } = useSession()
    const router      = useRouter()
    const { theme }   = useTheme()
    const isDark      = theme === 'dark'
    const isClaude    = theme === 'claude-code'

    const proAccentIcon = isClaude ? 'text-[var(--accent)]' : isDark ? 'text-emerald-400' : 'text-[var(--success)]'
    const proLabelClass = isClaude ? 'text-[var(--accent)]' : isDark ? 'text-emerald-400' : 'text-[var(--accent)]'
    const proPriceMuted = isClaude ? 'text-[var(--accent)]' : isDark ? 'text-emerald-400' : 'text-[var(--accent)]'

    const [loading, setLoading]             = useState(false)
    const [currentPlan, setCurrentPlan]     = useState<string | null>(null)
    const [proExpiresAt, setProExpiresAt]   = useState<string | null>(null)
    const [proDaysLeft, setProDaysLeft]     = useState<number | null>(null)
    const [planLoading, setPlanLoading]     = useState(true)
    const [successBanner, setSuccessBanner] = useState(false)
    const [errorMsg, setErrorMsg]           = useState<string | null>(null)
    const [verifying, setVerifying]         = useState(false)
    const [phone, setPhone]                 = useState('')

    // Load user's current plan + saved phone (for Razorpay checkout prefill)
    useEffect(() => {
        if (status === 'authenticated') {
            Promise.all([
                fetch('/api/user/subscription'),
                fetch('/api/user/profile'),
            ])
                .then(async ([subRes, profileRes]) => {
                    const sub = await readJsonResponse<{
                        plan?: string
                        expiresAt?: string | null
                        daysRemaining?: number | null
                    }>(subRes)
                    setCurrentPlan(sub?.plan ?? 'free')
                    setProExpiresAt(sub?.expiresAt ?? null)
                    setProDaysLeft(
                        typeof sub?.daysRemaining === 'number' ? sub.daysRemaining : null
                    )
                    const prof = await readJsonResponse<{ phone?: string | null }>(profileRes)
                    if (prof?.phone) setPhone(prof.phone)
                })
                .catch(() => setCurrentPlan('free'))
                .finally(() => setPlanLoading(false))
        } else if (status !== 'loading') {
            setPlanLoading(false)
        }
    }, [status])

    const completeProActivation = useCallback(async () => {
        setCurrentPlan('pro')
        const subRes = await fetch('/api/user/subscription')
        const sub = await readJsonResponse<{
            expiresAt?: string | null
            daysRemaining?: number | null
        }>(subRes)
        setProExpiresAt(sub?.expiresAt ?? null)
        setProDaysLeft(typeof sub?.daysRemaining === 'number' ? sub.daysRemaining : null)
        setSuccessBanner(true)
    }, [])

    // Initiate checkout
    const handleSubscribe = async () => {
        if (status !== 'authenticated') {
            router.push('/login?callbackUrl=/pricing')
            return
        }
        if (currentPlan === 'pro') return

        const digits = phone.replace(/\D/g, '')
        let mobile = digits
        if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2)
        if (mobile.length !== 10 || !/^[6-9]\d{9}$/.test(mobile)) {
            setErrorMsg('Enter a valid 10-digit Indian mobile number (required for Razorpay prefill / UPI).')
            return
        }

        const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
        if (!keyId) {
            setErrorMsg('Payments are not configured (NEXT_PUBLIC_RAZORPAY_KEY_ID missing).')
            return
        }

        setLoading(true)
        setErrorMsg(null)
        try {
            const res = await fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan: 'pro', phone: mobile }),
            })
            const data = await readJsonResponse<{
                error?: string
                code?: string
                subscription_id?: string
                order_id?: string
                amount?: number
                currency?: string
            }>(res)
            if (!data) {
                throw new Error(
                    res.status >= 500
                        ? 'Server error while starting payment. Check Vercel logs and database migration (Payment table).'
                        : 'Empty response from server. Please try again.'
                )
            }
            if (!res.ok) throw new Error(data.error || `Failed to create subscription (${res.status})`)

            const subscriptionId = data.subscription_id
            const orderId = data.order_id

            if (!subscriptionId && (!orderId || data.amount == null || !data.currency)) {
                throw new Error(
                    'Payment could not be started — invalid response. Check Razorpay keys and RAZORPAY_PLAN_ID.'
                )
            }

            await loadRazorpayScript()

            const options: Record<string, unknown> = {
                key: keyId,
                name: 'iStocks',
                description: 'Pro subscription — ₹499/month (autopay)',
                prefill: {
                    name: session?.user?.name ?? undefined,
                    email: session?.user?.email ?? undefined,
                    contact: mobile,
                },
                theme: { color: '#52a88c' },
                modal: {
                    ondismiss: () => {
                        setLoading(false)
                    },
                },
                handler: async (response: Record<string, string>) => {
                    setVerifying(true)
                    setErrorMsg(null)
                    try {
                        const verifyBody = subscriptionId
                            ? {
                                  razorpay_subscription_id: response.razorpay_subscription_id,
                                  razorpay_payment_id: response.razorpay_payment_id,
                                  razorpay_signature: response.razorpay_signature,
                              }
                            : {
                                  razorpay_order_id: response.razorpay_order_id,
                                  razorpay_payment_id: response.razorpay_payment_id,
                                  razorpay_signature: response.razorpay_signature,
                              }
                        const verifyRes = await fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(verifyBody),
                        })
                        const verifyData = await readJsonResponse<{
                            error?: string
                            success?: boolean
                            status?: string
                        }>(verifyRes)
                        if (!verifyRes.ok || !verifyData?.success) {
                            throw new Error(verifyData?.error || 'Payment verification failed')
                        }
                        await completeProActivation()
                    } catch (e: unknown) {
                        setErrorMsg(
                            e instanceof Error
                                ? e.message
                                : 'Verification failed. Contact support with your payment ID.'
                        )
                    } finally {
                        setVerifying(false)
                        setLoading(false)
                    }
                },
            }

            if (subscriptionId) {
                options.subscription_id = subscriptionId
            } else {
                options.amount = data.amount
                options.currency = data.currency
                options.order_id = orderId
            }

            const rzp = new window.Razorpay(options)
            rzp.on('payment.failed', (failureResponse: unknown) => {
                const fr = failureResponse as { error?: { description?: string; reason?: string } }
                const reason =
                    fr?.error?.description ||
                    fr?.error?.reason ||
                    'Payment failed. Try another method or try again.'
                setErrorMsg(reason)
                setLoading(false)
            })

            setLoading(false)
            rzp.open()
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
            setLoading(false)
        }
    }

    const isPro = currentPlan === 'pro'

    return (
        <main className="min-h-screen pt-24 pb-16 px-4 bg-[var(--bg-primary)]">
            {/* Success banner */}
            {successBanner && (
                <div
                    className={cn(
                        'max-w-3xl mx-auto mb-6 rounded-xl px-5 py-4 flex items-center gap-3 border',
                        isDark && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                        !isDark &&
                            isClaude &&
                            'bg-[var(--accent-bg)] border-[var(--border-color)] text-[var(--text-primary)]',
                        !isDark &&
                            !isClaude &&
                            'bg-[var(--badge-bg)] border-[var(--border-color)] text-[var(--text-primary)]',
                    )}
                >
                    <BadgeCheck className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Pro activated! Enjoy unlimited access.</span>
                </div>
            )}

            {/* Verifying overlay */}
            {verifying && (
                <div
                    className={cn(
                        'max-w-3xl mx-auto mb-6 rounded-xl px-5 py-4 flex items-center gap-3 border',
                        isDark ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-blue-500/10 border-blue-500/25 text-[var(--text-primary)]',
                    )}
                >
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                    <span className="font-medium">Verifying your payment…</span>
                </div>
            )}

            {/* Error banner */}
            {errorMsg && (
                <div
                    className={cn(
                        'max-w-3xl mx-auto mb-6 rounded-xl px-5 py-4 border text-sm',
                        isDark ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-[var(--danger-bg)] border-[var(--danger)]/25 text-[var(--danger)]',
                    )}
                >
                    {errorMsg}
                </div>
            )}

            {/* Header */}
            <div className="text-center mb-14">
                <div
                    className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4 text-xs font-semibold uppercase tracking-widest border"
                    style={{
                        background: 'var(--badge-bg)',
                        color: 'var(--badge-text)',
                        borderColor: 'var(--border-color)',
                    }}
                >
                    <Sparkles className="w-3.5 h-3.5" /> Simple Pricing
                </div>
                <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Unlock your trading edge
                </h1>
                <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
                    Start free. Upgrade when you&apos;re ready for unlimited AI power and higher paper trade limits.
                </p>
            </div>

            {/* Cards */}
            <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">

                {/* Free plan */}
                <div
                    className="rounded-2xl p-8 flex flex-col border"
                    style={{
                        background: 'var(--card-bg)',
                        borderColor: 'var(--card-border)',
                    }}
                >
                    <div className="mb-6">
                        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Free</p>
                        <div className="flex items-end gap-1 mb-2">
                            <span className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>₹0</span>
                            <span className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>/month</span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Perfect for getting started</p>
                    </div>

                    <ul className="space-y-3 mb-8 flex-1">
                        {FREE_FEATURES.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                <CheckCircle2 className={cn('w-4 h-4 mt-0.5 flex-shrink-0', proAccentIcon)} />
                                {f.text}
                            </li>
                        ))}
                    </ul>

                    <button
                        disabled
                        className="w-full rounded-xl py-3 text-sm font-semibold border"
                        style={{
                            color: 'var(--text-muted)',
                            borderColor: 'var(--border-subtle)',
                            cursor: 'default',
                        }}
                    >
                        {isPro ? 'Your previous plan' : 'Current plan'}
                    </button>
                </div>

                {/* Pro plan */}
                <div
                    className="rounded-2xl p-8 flex flex-col relative overflow-hidden"
                    style={proCardChrome(theme)}
                >
                    {/* Corner badge: plan label vs unlocked */}
                    <div
                        className="absolute top-5 right-5 flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white"
                        style={{ background: cornerBadgeBackground(isPro, theme) }}
                    >
                        {isPro ? (
                            <>
                                <Unlock className="w-3 h-3" /> Unlocked
                            </>
                        ) : (
                            <>
                                <Crown className="w-3 h-3" /> Pro
                            </>
                        )}
                    </div>

                    <div className="mb-6">
                        <p className={cn('text-xs font-semibold uppercase tracking-widest mb-1', proLabelClass)}>
                            {isPro ? 'Pro — member' : 'Pro'}
                        </p>
                        <div className="flex items-end gap-1 mb-2">
                            <span className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>₹499</span>
                            <span className={cn('text-sm mb-1', proPriceMuted)}>/month</span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Everything you need to trade smarter</p>
                    </div>

                    <ul className="space-y-3 mb-8 flex-1">
                        {PRO_FEATURES.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                <f.icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', proAccentIcon)} />
                                {f.text}
                            </li>
                        ))}
                    </ul>

                    {planLoading ? (
                        <div className="w-full rounded-xl py-3 flex items-center justify-center">
                            <Loader2 className={cn('w-5 h-5 animate-spin', proAccentIcon)} />
                        </div>
                    ) : isPro ? (
                        <div
                            className="w-full rounded-xl py-3.5 flex flex-col items-center justify-center gap-1 text-center"
                            style={proMemberStatusBox(theme)}
                        >
                            <div className="flex items-center justify-center gap-2 font-semibold text-sm">
                                <Unlock className="w-4 h-4" />
                                Pro unlocked
                            </div>
                            <p
                                className={cn(
                                    'text-[11px] font-normal max-w-[260px]',
                                    isDark ? 'text-emerald-200/70' : 'text-[var(--text-secondary)]',
                                )}
                            >
                                You&apos;re on Pro — full AI access and higher paper limits are active.
                            </p>
                            {proExpiresAt ? (
                                <p
                                    className={cn(
                                        'text-[11px] font-medium mt-1.5 max-w-[260px]',
                                        isDark ? 'text-amber-200/90' : 'text-[var(--accent)]',
                                    )}
                                >
                                    Ends{' '}
                                    {new Date(proExpiresAt).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric',
                                    })}
                                    {proDaysLeft != null
                                        ? ` · ${proDaysLeft} day${proDaysLeft === 1 ? '' : 's'} left`
                                        : ''}
                                </p>
                            ) : (
                                <p
                                    className={cn(
                                        'text-[10px] mt-1 max-w-[260px]',
                                        isDark ? 'text-emerald-200/60' : 'text-[var(--text-muted)]',
                                    )}
                                >
                                    Renew to extend your 30-day Pro period.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <label
                                    className={cn(
                                        'block text-xs font-medium mb-1.5',
                                        isClaude && 'text-[var(--accent)]',
                                        isDark && 'text-emerald-300/90',
                                        !isClaude && !isDark && 'text-[var(--accent)]',
                                    )}
                                >
                                    Mobile number (for payment &amp; UPI)
                                </label>
                                <div className="relative">
                                    <Phone
                                        className={cn(
                                            'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4',
                                            isDark ? 'text-emerald-500/70' : 'text-[var(--accent)]/70',
                                        )}
                                    />
                                    <input
                                        type="tel"
                                        inputMode="numeric"
                                        autoComplete="tel"
                                        placeholder="10-digit mobile"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className={cn(
                                            'w-full pl-10 pr-3 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2',
                                            isDark &&
                                                'border-emerald-500/25 bg-dark-100/50 text-white placeholder-gray-500 focus:ring-emerald-500/30',
                                            !isDark &&
                                                'border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:ring-2',
                                            isClaude && !isDark && 'focus:ring-[var(--accent)]/35',
                                            !isClaude && !isDark && 'focus:ring-emerald-500/40',
                                        )}
                                    />
                                </div>
                                <p
                                    className={cn(
                                        'text-[11px] mt-1.5',
                                        isDark ? 'text-gray-500' : 'text-[var(--text-muted)]',
                                    )}
                                >
                                    Razorpay uses this for checkout prefill. We save it on your account for next time.
                                </p>
                                <p
                                    className={cn(
                                        'text-[11px] mt-2 leading-relaxed rounded-lg px-2.5 py-2 border',
                                        isDark ? 'text-gray-400 border-white/10 bg-white/[0.03]' : 'text-[var(--text-secondary)] border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
                                    )}
                                >
                                    <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                        Billing entity:
                                    </strong>{' '}
                                    When you pay, you are transacting with <strong>iStocks</strong>.{' '}
                                    <strong>iStocks</strong> is a subsidiary of <strong>INFINITEST</strong>.
                                </p>
                            </div>
                            <button
                                onClick={handleSubscribe}
                                disabled={loading}
                                className="w-full rounded-xl py-3 flex items-center justify-center gap-2 text-sm font-semibold text-white transition-all"
                                style={subscribeButtonBackground(loading, theme)}
                            >
                                {loading ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                                ) : (
                                    <>Get Pro <ArrowRight className="w-4 h-4" /></>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* FAQ / trust note */}
            <div className="max-w-2xl mx-auto mt-14 text-center space-y-2">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    🔒 Payments processed securely by <strong>Razorpay</strong>. No card data stored on iStocks servers.{' '}
                    <strong>iStocks</strong> is a subsidiary of <strong>INFINITEST</strong>.
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Subscription activates instantly. ₹499/month autopay via UPI or card — cancel anytime from Razorpay or contact support.
                </p>
            </div>
        </main>
    )
}
