'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

const ERROR_MESSAGES: Record<string, string> = {
    missing_token: 'Invalid link — token is missing. Please request a new link from the bot.',
    invalid_token: 'This link is invalid. Please send /start to the bot to get a new link.',
    expired: 'This link has expired (valid for 15 minutes). Please send /start to the bot again.',
    already_used: 'This link has already been used. Your account may already be linked.',
    already_linked: 'This Telegram account is already linked to a different istocks account.',
    user_not_found: 'Your account was not found. Please try logging in again.',
    server_error: 'Something went wrong. Please try again or contact support.',
}

function LinkTelegramContent() {
    const params = useSearchParams()
    const success = params.get('success')
    const error = params.get('error')

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
                    <div className="text-6xl mb-4">🎉</div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Telegram Linked!</h1>
                    <p className="text-gray-500 mb-6">
                        Your Telegram account is now connected to iStocks. Go back to the bot and start asking questions!
                    </p>
                    <a
                        href="https://t.me/IstocksAiBot"
                        className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded-xl transition"
                    >
                        Open Bot →
                    </a>
                    <div className="mt-4">
                        <Link href="/stocks" className="text-sm text-gray-400 hover:text-gray-600">
                            Go to iStocks
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
                    <div className="text-6xl mb-4">❌</div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Link Failed</h1>
                    <p className="text-gray-500 mb-6">
                        {ERROR_MESSAGES[error] || 'An unexpected error occurred.'}
                    </p>
                    <a
                        href="https://t.me/IstocksAiBot"
                        className="inline-block bg-gray-800 hover:bg-gray-900 text-white font-semibold px-6 py-3 rounded-xl transition"
                    >
                        Back to Bot
                    </a>
                </div>
            </div>
        )
    }

    // Default: show instructions (user landed here without a token)
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
                <div className="text-6xl mb-4">📱</div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Connect Telegram</h1>
                <p className="text-gray-500 mb-6">
                    To use the iStocks Telegram bot, open the bot and send <code className="bg-gray-100 px-1 rounded">/start</code> to get your personal login link.
                </p>
                <a
                    href="https://t.me/IstocksAiBot"
                    className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded-xl transition"
                >
                    Open iStocks Bot
                </a>
            </div>
        </div>
    )
}

export default function LinkTelegramPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
            <LinkTelegramContent />
        </Suspense>
    )
}
