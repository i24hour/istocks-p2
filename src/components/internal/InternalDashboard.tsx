'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut, RefreshCw } from 'lucide-react'

type Tab = 'users' | 'payments' | 'pro'

type UserRow = {
    id: string
    name: string | null
    email: string
    plan: string
    createdAt: string
    dailyPromptCount: number
    lifetimePromptCount: number
}

type PaymentRow = {
    id: string
    userEmail: string | null
    userName: string | null
    amount: number
    currency: string
    status: string
    plan: string
    paymentOrderId: string
    paymentId: string | null
    billingMode: 'autopay' | 'one_time'
    isAutopay: boolean
    createdAt: string
    updatedAt: string
}

type ProUserRow = {
    subscriptionId: string
    userId: string
    name: string | null
    email: string
    billingMode: 'autopay' | 'one_time'
    isAutopay: boolean
    subscriptionStartedAt: string
    subscriptionExpiresAt: string | null
    lastPaymentAt: string | null
}

function formatDate(value: string | null) {
    if (!value) return '—'
    return new Date(value).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

function formatAmount(amount: number, currency: string) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(amount)
}

function BillingBadge({ billingMode }: { billingMode: 'autopay' | 'one_time' }) {
    const isAutopay = billingMode === 'autopay'
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isAutopay
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }`}
        >
            {isAutopay ? 'Autopay' : 'One-time'}
        </span>
    )
}

function TableShell({
    title,
    count,
    children,
}: {
    title: string
    count: number
    children: React.ReactNode
}) {
    return (
        <section className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]">
            <div className="border-b border-[var(--border-color)] px-4 py-3">
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="text-xs text-[var(--text-muted)]">{count} rows (latest first, max 200)</p>
            </div>
            <div className="overflow-x-auto">{children}</div>
        </section>
    )
}

function thClass() {
    return 'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
}

function tdClass() {
    return 'whitespace-nowrap px-4 py-3 text-sm text-[var(--text-primary)]'
}

export default function InternalDashboard({ adminUser }: { adminUser: string }) {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('users')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [users, setUsers] = useState<UserRow[]>([])
    const [payments, setPayments] = useState<PaymentRow[]>([])
    const [proUsers, setProUsers] = useState<ProUserRow[]>([])

    const loadData = useCallback(async () => {
        setLoading(true)
        setError('')

        try {
            const [usersRes, paymentsRes, proRes] = await Promise.all([
                fetch('/api/internal/users'),
                fetch('/api/internal/payments'),
                fetch('/api/internal/pro-users'),
            ])

            if ([usersRes, paymentsRes, proRes].some((res) => res.status === 401)) {
                router.replace('/internal')
                return
            }

            if (!usersRes.ok || !paymentsRes.ok || !proRes.ok) {
                setError('Failed to load dashboard data.')
                return
            }

            const [usersData, paymentsData, proData] = await Promise.all([
                usersRes.json(),
                paymentsRes.json(),
                proRes.json(),
            ])

            setUsers(usersData.users ?? [])
            setPayments(paymentsData.payments ?? [])
            setProUsers(proData.proUsers ?? [])
        } catch {
            setError('Network error while loading data.')
        } finally {
            setLoading(false)
        }
    }, [router])

    useEffect(() => {
        void loadData()
    }, [loadData])

    const handleLogout = async () => {
        await fetch('/api/internal/logout', { method: 'POST' })
        router.replace('/internal')
        router.refresh()
    }

    const tabs: { id: Tab; label: string; count: number }[] = [
        { id: 'users', label: 'Users', count: users.length },
        { id: 'payments', label: 'Payments', count: payments.length },
        { id: 'pro', label: 'Pro users', count: proUsers.length },
    ]

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">Internal dashboard</h1>
                    <p className="text-sm text-[var(--text-secondary)]">
                        Signed in as <span className="font-medium">{adminUser}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void loadData()}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm hover:bg-[var(--bg-surface-hover)] disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                    >
                        <LogOut className="h-4 w-4" />
                        Log out
                    </button>
                </div>
            </header>

            <div className="mb-6 flex flex-wrap gap-2">
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                            tab === item.id
                                ? 'bg-[var(--accent)] text-white'
                                : 'border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]'
                        }`}
                    >
                        {item.label} ({item.count})
                    </button>
                ))}
            </div>

            {error ? (
                <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            ) : null}

            {loading ? (
                <div className="flex items-center justify-center py-24 text-[var(--text-secondary)]">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Loading…
                </div>
            ) : null}

            {!loading && tab === 'users' ? (
                <TableShell title="Users" count={users.length}>
                    <table className="min-w-full divide-y divide-[var(--border-color)]">
                        <thead className="bg-[var(--bg-secondary)]">
                            <tr>
                                <th className={thClass()}>Name</th>
                                <th className={thClass()}>Email</th>
                                <th className={thClass()}>Plan</th>
                                <th className={thClass()}>Daily prompts</th>
                                <th className={thClass()}>Lifetime prompts</th>
                                <th className={thClass()}>Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-[var(--bg-surface-hover)]">
                                    <td className={tdClass()}>{user.name || '—'}</td>
                                    <td className={tdClass()}>{user.email}</td>
                                    <td className={tdClass()}>
                                        <span
                                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                user.plan === 'pro'
                                                    ? 'bg-emerald-50 text-[var(--badge-text)]'
                                                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                                            }`}
                                        >
                                            {user.plan}
                                        </span>
                                    </td>
                                    <td className={tdClass()}>{user.dailyPromptCount}</td>
                                    <td className={tdClass()}>{user.lifetimePromptCount}</td>
                                    <td className={tdClass()}>{formatDate(user.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            ) : null}

            {!loading && tab === 'payments' ? (
                <TableShell title="Payments" count={payments.length}>
                    <table className="min-w-full divide-y divide-[var(--border-color)]">
                        <thead className="bg-[var(--bg-secondary)]">
                            <tr>
                                <th className={thClass()}>User</th>
                                <th className={thClass()}>Email</th>
                                <th className={thClass()}>Amount</th>
                                <th className={thClass()}>Status</th>
                                <th className={thClass()}>Plan</th>
                                <th className={thClass()}>Billing</th>
                                <th className={thClass()}>Order ID</th>
                                <th className={thClass()}>Payment ID</th>
                                <th className={thClass()}>Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {payments.map((payment) => (
                                <tr key={payment.id} className="hover:bg-[var(--bg-surface-hover)]">
                                    <td className={tdClass()}>{payment.userName || '—'}</td>
                                    <td className={tdClass()}>{payment.userEmail || '—'}</td>
                                    <td className={tdClass()}>
                                        {formatAmount(payment.amount, payment.currency)}
                                    </td>
                                    <td className={tdClass()}>{payment.status}</td>
                                    <td className={tdClass()}>{payment.plan}</td>
                                    <td className={tdClass()}>
                                        <BillingBadge billingMode={payment.billingMode} />
                                    </td>
                                    <td className={`${tdClass()} font-mono text-xs`}>
                                        {payment.paymentOrderId}
                                    </td>
                                    <td className={`${tdClass()} font-mono text-xs`}>
                                        {payment.paymentId || '—'}
                                    </td>
                                    <td className={tdClass()}>{formatDate(payment.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            ) : null}

            {!loading && tab === 'pro' ? (
                <TableShell title="Paid / Pro users" count={proUsers.length}>
                    <table className="min-w-full divide-y divide-[var(--border-color)]">
                        <thead className="bg-[var(--bg-secondary)]">
                            <tr>
                                <th className={thClass()}>Name</th>
                                <th className={thClass()}>Email</th>
                                <th className={thClass()}>Autopay</th>
                                <th className={thClass()}>Last payment</th>
                                <th className={thClass()}>Subscription started</th>
                                <th className={thClass()}>Expires</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {proUsers.map((row) => (
                                <tr key={row.subscriptionId} className="hover:bg-[var(--bg-surface-hover)]">
                                    <td className={tdClass()}>{row.name || '—'}</td>
                                    <td className={tdClass()}>{row.email}</td>
                                    <td className={tdClass()}>
                                        <BillingBadge billingMode={row.billingMode} />
                                    </td>
                                    <td className={tdClass()}>{formatDate(row.lastPaymentAt)}</td>
                                    <td className={tdClass()}>{formatDate(row.subscriptionStartedAt)}</td>
                                    <td className={tdClass()}>{formatDate(row.subscriptionExpiresAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            ) : null}
        </div>
    )
}
