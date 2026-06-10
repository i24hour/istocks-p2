'use client'

import { useState, Suspense, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react'

// Same red/green candle logo as Header
const IStocksLogo = ({ className = '' }: { className?: string }) => (
    <svg viewBox="0 0 40 32" className={className} fill="none">
        <rect x="0" y="4" width="6" height="28" rx="1" fill="#10b981" />
        <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
        <rect x="16" y="14" width="6" height="18" rx="1" fill="#10b981" />
        <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
        <rect x="32" y="2" width="6" height="30" rx="1" fill="#10b981" />
    </svg>
)
import Link from 'next/link'

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get('callbackUrl') || '/'
    const error = searchParams.get('error')

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [isInAppWebView, setIsInAppWebView] = useState(false)

    useEffect(() => {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
        const isAndroidWebView = /\bwv\b|; wv\)/i.test(ua)
        const isIosWebView = /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua)
        const isCapacitorNative =
            typeof window !== 'undefined' &&
            typeof (window as any)?.Capacitor?.isNativePlatform === 'function' &&
            Boolean((window as any).Capacitor.isNativePlatform())

        setIsInAppWebView(Boolean(isCapacitorNative || isAndroidWebView || isIosWebView))
    }, [])

    // Better error messages based on NextAuth error types
    const getErrorMessage = (errorCode: string | null): string => {
        if (!errorCode) return ''
        switch (errorCode) {
            case 'OAuthAccountNotLinked':
                return 'This email is already registered. Please sign in with your original method.'
            case 'OAuthCallback':
                return 'Error during Google sign in. Please check your credentials.'
            case 'OAuthSignin':
                return 'Error starting Google sign in. Please try again.'
            case 'Configuration':
                return 'Server configuration error. Please contact support.'
            case 'AccessDenied':
                return 'Access denied. You may have cancelled the sign in.'
            case 'CredentialsSignin':
                return 'Invalid email or password'
            default:
                return `Authentication error: ${errorCode}`
        }
    }

    const [errorMessage, setErrorMessage] = useState(getErrorMessage(error))

    const handleCredentialsLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setErrorMessage('')

        try {
            const result = await signIn('credentials', {
                email,
                password,
                redirect: false,
            })

            if (result?.error) {
                setErrorMessage(result.error)
            } else {
                router.push(callbackUrl)
                router.refresh()
            }
        } catch (error) {
            setErrorMessage('Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    const handleGoogleLogin = () => {
        if (isInAppWebView) {
            setErrorMessage('Google sign in is blocked in in-app browsers by Google policy. Please use email/password sign in inside the app.')
            return
        }
        signIn('google', { callbackUrl })
    }

    return (
        <div className="w-full max-w-md">
            {/* Logo */}
            <div className="text-center mb-8">
                <Link href="/" className="inline-flex items-center gap-2">
                    <div className="flex items-center justify-center">
                        <IStocksLogo className="w-12 h-12" />
                    </div>
                    <span className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
                        iStocks
                    </span>
                </Link>
            </div>

            {/* Card */}
            <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-8 border border-white/10">
                <h1 className="text-2xl font-bold text-white text-center mb-2">Welcome Back</h1>
                <p className="text-gray-400 text-center mb-6">Sign in to continue</p>

                {/* Error Message */}
                {errorMessage && (
                    <div className="flex items-center gap-2 p-3 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        {errorMessage}
                    </div>
                )}

                {/* Credentials Form */}
                <form onSubmit={handleCredentialsLogin} className="space-y-4">
                    <div>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email"
                                required
                                className="w-full pl-11 pr-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                required
                                className="w-full pl-11 pr-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </div>

                    <div className="text-right">
                        <Link href="/forgot-password" className="text-sm text-emerald-400 hover:text-emerald-300">
                            Forgot password?
                        </Link>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Signing in...
                            </>
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-4 my-6">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-gray-500 text-sm">or continue with</span>
                    <div className="flex-1 h-px bg-white/10" />
                </div>

                {isInAppWebView && (
                    <div className="flex items-start gap-2 p-3 mb-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5" />
                        <span>Google sign in is not supported inside this app WebView. Use email/password below.</span>
                    </div>
                )}

                {/* Google Login */}
                <button
                    onClick={handleGoogleLogin}
                    disabled={isInAppWebView}
                    className="w-full py-3 bg-white text-gray-900 font-semibold rounded-xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                {/* Sign Up Link */}
                <p className="text-center text-gray-400 mt-6">
                    Don&apos;t have an account?{' '}
                    <Link href="/signup" className="text-emerald-400 hover:text-emerald-300 font-medium">
                        Create account
                    </Link>
                </p>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center p-4">
            <Suspense fallback={
                <div className="flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            }>
                <LoginForm />
            </Suspense>
        </div>
    )
}
