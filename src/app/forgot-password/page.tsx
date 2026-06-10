'use client'

import { useState } from 'react'
import Link from 'next/link'
import { TrendingUp, Mail, ArrowRight, Loader2, CheckCircle, ArrowLeft, AlertCircle } from 'lucide-react'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [devLink, setDevLink] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSuccessMessage('')
        setDevLink('')
        setLoading(true)

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            })

            const data = await response.json().catch(() => ({}))

            if (!response.ok || data?.success === false) {
                setError(data?.error || 'Unable to send reset email right now. Please try again.')
                return
            }

            setSuccessMessage(data?.message || 'If an account exists, email sent.')
            if (typeof data?.devLink === 'string') {
                setDevLink(data.devLink)
            }
            setSubmitted(true)
        } catch {
            setError('Unable to send reset email right now. Please check your connection and try again.')
        } finally {
            setLoading(false)
        }

    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-2">
                        <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-green-600 rounded-xl flex items-center justify-center shadow-glow-green">
                            <TrendingUp className="w-7 h-7 text-white" />
                        </div>
                        <span className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
                            iStocks
                        </span>
                    </Link>
                </div>

                {/* Card */}
                <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-8 border border-white/10 relative overflow-hidden">
                    {!submitted ? (
                        <>
                            <h1 className="text-2xl font-bold text-white text-center mb-2">Reset Password</h1>
                            <p className="text-gray-400 text-center mb-6">
                                Enter your email address and we'll send you a link to reset your password.
                            </p>

                            {error && (
                                <div className="flex items-center gap-2 p-3 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="Email address"
                                            required
                                            className="w-full pl-11 pr-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            Send Reset Link
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </form>
                        </>
                    ) : (
                        <div className="text-center py-4">
                            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                                <CheckCircle className="w-8 h-8 text-emerald-500" />
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Check your email</h2>
                            <p className="text-gray-400 mb-6">
                                {successMessage || "We've sent a password reset link."}
                                <br />
                                <span className="text-white font-medium">{email}</span>
                            </p>
                            <p className="text-sm text-gray-500">
                                Didn't receive the email? Check your spam folder or try again.
                            </p>

                            {devLink && (
                                <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-left">
                                    <p className="text-xs text-emerald-300 break-all">Dev reset link: {devLink}</p>
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    setSubmitted(false)
                                    setError('')
                                    setDevLink('')
                                    setSuccessMessage('')
                                }}
                                className="mt-6 text-emerald-400 hover:text-emerald-300 font-medium text-sm"
                            >
                                Try different email
                            </button>
                        </div>
                    )}

                    <div className="mt-8 text-center pt-6 border-t border-white/10">
                        <Link href="/login" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
                            <ArrowLeft className="w-4 h-4" />
                            Back to Sign In
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}
