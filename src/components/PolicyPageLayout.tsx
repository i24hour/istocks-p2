import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface PolicyPageLayoutProps {
    title: string
    lastUpdated?: string
    children: ReactNode
}

export function PolicyPageLayout({ title, lastUpdated = '25 April 2026', children }: PolicyPageLayoutProps) {
    return (
        <div className="min-h-screen bg-gradient-to-b from-dark-100 to-dark-200 text-gray-200">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 pb-24">
                <Link
                    href="/stocks"
                    className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to app
                </Link>

                <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-2">{title}</h1>
                <p className="text-sm text-gray-500 mb-10">Last updated: {lastUpdated}</p>

                <article className="space-y-5 text-sm sm:text-base leading-relaxed text-gray-300">
                    {children}
                </article>
            </div>
        </div>
    )
}
