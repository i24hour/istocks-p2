import YahooFinance from 'yahoo-finance2'
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })
async function main() {
  const now = new Date()
  const period1 = new Date(); period1.setFullYear(now.getFullYear() - 1)
  const result: any = await yahooFinance.chart('ICICIBANK.NS', { period1, period2: now, interval: '1d', return: 'array' }, { validateResult: false })
  const quotes = Array.isArray(result?.quotes) ? result.quotes : []
  console.log('rawLast5', quotes.slice(-5).map((q: any) => ({
    date: q?.date instanceof Date ? q.date.toISOString() : String(q?.date),
    open: q?.open,
    high: q?.high,
    low: q?.low,
    close: q?.close,
    volume: q?.volume,
  })))
}
main().catch(err => { console.error(err); process.exit(1) })
