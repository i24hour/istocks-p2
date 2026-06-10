export const STOCKS = [
    {
        symbol: 'WIPRO',
        name: 'Wipro Limited',
        exchange: 'NSE',
        angelOneSymbol: 'WIPRO',
    },
    {
        symbol: 'VEDL',
        name: 'Vedanta Limited',
        exchange: 'NSE',
        angelOneSymbol: 'VEDL',
    },
    {
        symbol: 'ADANIPOWER',
        name: 'Adani Power Limited',
        exchange: 'NSE',
        angelOneSymbol: 'ADANIPOWER',
    },
] as const

export type StockSymbol = typeof STOCKS[number]['symbol']
