import type { Metadata } from 'next'

const title = 'Trading Agent | iStocks'
const description =
  'Natural-language stock data analyst — query Indian markets and compare securities with AI-assisted answers.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
}

export default function DatabaseChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
