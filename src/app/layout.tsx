import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/SessionProvider'
import ThemeProvider from '@/components/ThemeProvider'
import { SiteChrome } from '@/components/SiteChrome'
import { getMetadataBaseURL } from '@/lib/site-url'

const inter = Inter({ subsets: ['latin'] })

const SITE_NAME = 'iStocks'
const ROOT_TITLE_DEFAULT = `${SITE_NAME} — AI-powered stock research & trading tools`
const ROOT_DESCRIPTION =
  'Explore Indian equities with charts, portfolio tools, paper trading, and an AI-assisted analyst grounded in live market data—built for informed decision-making.'

export const metadata: Metadata = {
  metadataBase: getMetadataBaseURL(),
  title: ROOT_TITLE_DEFAULT,
  description: ROOT_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    SITE_NAME.toLowerCase(),
    'Indian stock market',
    'NSE',
    'stock research',
    'equity analysis',
    'paper trading',
    'portfolio',
    'technical analysis',
    'AI analyst',
    'market data',
  ],
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    siteName: SITE_NAME,
    title: ROOT_TITLE_DEFAULT,
    description: ROOT_DESCRIPTION,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'iStocks stock analysis dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: ROOT_TITLE_DEFAULT,
    description: ROOT_DESCRIPTION,
  },
}

export const viewport = {
  themeColor: '#0d0d0d',
}


export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <SessionProvider>
          <ThemeProvider>
            <SiteChrome>{children}</SiteChrome>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
