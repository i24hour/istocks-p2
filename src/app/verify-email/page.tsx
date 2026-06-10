'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'

function VerifyEmailContent() {
    const searchParams = useSearchParams()
    const token = searchParams.get('token')

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('')

    useEffect(() => {
        if (token) {
            verifyEmail()
        } else {
            setStatus('error')
            setMessage('Missing verification token')
        }
    }, [token])

    const verifyEmail = async () => {
        try {
            const response = await fetch(`/api/auth/verify-email?token=${token}`)
            const data = await response.json()

            if (response.ok) {
                setStatus('success')
                setMessage(data.message)
            } else {
                setStatus('error')
                setMessage(data.error)
            }
        } catch (error) {
            setStatus('error')
            setMessage('Failed to verify email')
        }
    }

    return (
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
            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-8 border border-white/10 text-center">
                {status === 'loading' && (
                    <>
                        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Verifying Email</h1>
                        <p className="text-gray-400">Please wait...</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Email Verified!</h1>
                        <p className="text-gray-400 mb-6">{message}</p>
                        <Link
                            href="/login"
                            className="inline-block px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all"
                        >
                            Go to Login
                        </Link>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <XCircle className="w-8 h-8 text-red-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Verification Failed</h1>
                        <p className="text-gray-400 mb-6">{message}</p>
                        <Link
                            href="/signup"
                            className="inline-block px-6 py-3 bg-dark-400 text-white font-semibold rounded-xl hover:bg-dark-300 transition-colors"
                        >
                            Try Again
                        </Link>
                    </>
                )}
            </div>
        </div>
    )
}

export default function VerifyEmailPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center p-4">
            <Suspense fallback={
                <div className="flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            }>
                <VerifyEmailContent />
            </Suspense>
        </div>
    )
}
