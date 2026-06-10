'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, User } from 'lucide-react'

const IStocksLogo = ({ className = '' }: { className?: string }) => (
    <svg viewBox="0 0 40 32" className={className} fill="none" aria-hidden>
        <rect x="0" y="4" width="6" height="28" rx="1" fill="#52a88c" />
        <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
        <rect x="16" y="14" width="6" height="18" rx="1" fill="#52a88c" />
        <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
        <rect x="32" y="2" width="6" height="30" rx="1" fill="#52a88c" />
    </svg>
)

export default function InternalLoginForm() {
    const router = useRouter()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        setLoading(true)
        setError('')

        try {
            const response = await fetch('/api/internal/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                setError(data.error || 'Login failed')
                return
            }

            router.push('/internal/dashboard')
            router.refresh()
        } catch {
            setError('Network error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center px-4 py-12">
            <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 shadow-sm">
                <div className="mb-8 flex flex-col items-center gap-3 text-center">
                    <IStocksLogo className="h-8 w-10" />
                    <div>
                        <h1 className="text-xl font-semibold">iStocks Internal</h1>
                        <p className="mt-1 text-sm text-[var(--text-secondary)]">
                            Employee dashboard sign-in
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
                            Username
                        </label>
                        <div className="relative">
                            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                id="username"
                                type="text"
                                autoComplete="username"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                            Password
                        </label>
                        <div className="relative">
                            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                id="password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                                required
                            />
                        </div>
                    </div>

                    {error ? (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                    ) : null}

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Sign in
                    </button>
                </form>
            </div>
        </div>
    )
}
