import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Internal — iStocks',
    robots: { index: false, follow: false },
}

export default function InternalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
            {children}
        </div>
    )
}
