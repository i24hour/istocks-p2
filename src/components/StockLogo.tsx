'use client'

import { useMemo, useState } from 'react'

interface StockLogoProps {
    symbol: string
    name: string
    exchange?: string
    sizeClassName?: string
    roundedClassName?: string
    fallbackGradientClassName?: string
}

const LOGO_BASE_URL = 'https://financialmodelingprep.com/image-stock'

function buildLogoCandidates(symbol: string, exchange?: string): string[] {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return []

    const preferredSuffix = exchange?.toUpperCase() === 'BSE' ? 'BO' : 'NS'
    const secondarySuffix = preferredSuffix === 'NS' ? 'BO' : 'NS'
    const tickers = new Set<string>([
        `${normalized}.${preferredSuffix}`,
        `${normalized}.${secondarySuffix}`,
        normalized,
    ])

    return Array.from(tickers).map((ticker) => `${LOGO_BASE_URL}/${encodeURIComponent(ticker)}.png`)
}

function getInitial(name: string, symbol: string): string {
    const source = (name || symbol || '?').trim()
    return source.charAt(0).toUpperCase() || '?'
}

export default function StockLogo({
    symbol,
    name,
    exchange,
    sizeClassName = 'w-10 h-10 md:w-12 md:h-12',
    roundedClassName = 'rounded-xl',
    fallbackGradientClassName = 'from-gray-600 to-gray-700',
}: StockLogoProps) {
    const candidates = useMemo(() => buildLogoCandidates(symbol, exchange), [symbol, exchange])
    const [candidateIndex, setCandidateIndex] = useState(0)
    const [loaded, setLoaded] = useState(false)

    const activeSrc = candidates[candidateIndex]
    const showImage = !!activeSrc && candidateIndex < candidates.length

    return (
        <div className={`${sizeClassName} ${roundedClassName} overflow-hidden shadow-lg shrink-0`}>
            {showImage ? (
                <img
                    src={activeSrc}
                    alt={`${name} logo`}
                    className={`h-full w-full object-cover bg-white ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={() => setLoaded(true)}
                    onError={() => {
                        setLoaded(false)
                        setCandidateIndex((prev) => prev + 1)
                    }}
                />
            ) : (
                <div className={`h-full w-full bg-gradient-to-br ${fallbackGradientClassName} flex items-center justify-center`}>
                    <span className="text-white font-bold text-base md:text-lg">{getInitial(name, symbol)}</span>
                </div>
            )}
        </div>
    )
}
