import type { Metadata } from 'next'
import { PolicyPageLayout } from '@/components/PolicyPageLayout'
import { Mail, MessageCircle } from 'lucide-react'
import Link from 'next/link'

const CONTACT_EMAIL = 'priyanshu85953@gmail.com'

export const metadata: Metadata = {
    title: 'Contact us | iStocks',
    description: 'Get in touch with the iStocks team for support, feedback, and partnerships.',
}

export default function ContactPage() {
    return (
        <PolicyPageLayout title="Contact us" lastUpdated="25 April 2026">
            <p>
                We are here to help with account issues, product feedback, and partnership enquiries. The fastest
                way to reach us is by email.
            </p>

            <div className="my-6 rounded-2xl border border-white/10 bg-dark-300/30 p-6">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                        <Mail className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-white">Email</h2>
                        <a
                            href={`mailto:${CONTACT_EMAIL}`}
                            className="text-emerald-400 hover:text-emerald-300 break-all"
                        >
                            {CONTACT_EMAIL}
                        </a>
                        <p className="mt-2 text-sm text-gray-500">
                            We try to respond within 2 business days. For security, never share passwords or
                            one-time codes in email.
                        </p>
                    </div>
                </div>
            </div>

            <h2 className="text-lg font-semibold text-white pt-2">What to include</h2>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
                <li>Your registered email (if the issue is about an account)</li>
                <li>What you were trying to do and what happened (screenshots help)</li>
                <li>Browser and device type, if the problem is on the website</li>
            </ul>

            <h2 className="text-lg font-semibold text-white pt-2">Product help</h2>
            <p>
                For how-to questions about the Trading Agent, paper trading, or brokers, see our{' '}
                <Link href="/about" className="text-emerald-400 hover:underline">
                    About
                </Link>{' '}
                page and in-app help first.
            </p>

            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-gray-500">
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>
                    Business address and legal entity details can be provided on request for invoices or contracts.
                </span>
            </div>
        </PolicyPageLayout>
    )
}
