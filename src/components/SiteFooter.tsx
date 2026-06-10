'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <Link
            href={href}
            className="text-sm text-gray-500 hover:text-emerald-400 transition-colors"
        >
            {children}
        </Link>
    )
}

const FOOTER_HIDDEN_PREFIXES = ['/database-chat', '/experts']

export function SiteFooter() {
    const pathname = usePathname() || ''
    const hideFooter = FOOTER_HIDDEN_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
    if (hideFooter) return null

    return (
        <footer
            className="border-t border-white/5 bg-dark-200/50 backdrop-blur-sm"
            style={{ borderColor: 'var(--border-color, rgba(255,255,255,0.08))' }}
        >
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-gray-500 text-center sm:text-left">
                        © {new Date().getFullYear()} iStocks. All rights reserved.
                    </p>
                    <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                        <FooterLink href="/contact">Contact us</FooterLink>
                        <span className="text-gray-600 hidden sm:inline" aria-hidden>
                            |
                        </span>
                        <FooterLink href="/privacy">Privacy Policy</FooterLink>
                        <span className="text-gray-600 hidden sm:inline" aria-hidden>
                            |
                        </span>
                        <FooterLink href="/terms">Terms &amp; Conditions</FooterLink>
                        <span className="text-gray-600 hidden sm:inline" aria-hidden>
                            |
                        </span>
                        <FooterLink href="/refunds">Refunds &amp; Cancellations</FooterLink>
                    </nav>
                </div>
            </div>
        </footer>
    )
}
