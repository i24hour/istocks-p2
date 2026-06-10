import type { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Pricing | iStocks',
    description:
        'Compare iStocks plans, billing, and benefits—choose the tier that fits your stock research and AI usage.',
    openGraph: {
        title: 'Pricing | iStocks',
        description:
            'Compare iStocks plans, billing, and benefits—choose the tier that fits your stock research and AI usage.',
        type: 'website',
        locale: 'en_IN',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Pricing | iStocks',
        description:
            'Compare iStocks plans, billing, and benefits—choose the tier that fits your stock research and AI usage.',
    },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children
}
