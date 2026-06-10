import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Stocks & markets | iStocks',
    description:
        'Browse Indian equities—quotes, movers, watchlists—and jump into research and charts for each symbol.',
    openGraph: {
        title: 'Stocks & markets | iStocks',
        description:
            'Browse Indian equities—quotes, movers, watchlists—and jump into research and charts for each symbol.',
        type: 'website',
        locale: 'en_IN',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Stocks & markets | iStocks',
        description:
            'Browse Indian equities—quotes, movers, watchlists—and jump into research and charts for each symbol.',
    },
}

export default function StocksLayout({ children }: { children: React.ReactNode }) {
    return children
}
