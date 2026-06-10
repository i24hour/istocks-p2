import { fetchOHLCV, computeIndicators } from '/Users/priyanshu/Desktop/Desktop/Github/istocks-p/src/lib/yahoo-finance'

async function main() {
  const candles = await fetchOHLCV('ICICIBANK', '1y', '1d')
  const bad = computeIndicators(candles)
  const filtered = candles.filter(c => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
  const fixed = computeIndicators(filtered)
  console.log({
    rawLast: candles[candles.length - 1],
    rawRsi: bad.rsi14,
    rawMacd: bad.macd,
    fixedLast: filtered[filtered.length - 1],
    fixedRsi: fixed.rsi14,
    fixedMacd: fixed.macd,
    fixedMacdSignal: fixed.macdSignal,
    fixedMacdHist: fixed.macdHist,
  })
}
main().catch(err => { console.error(err); process.exit(1) })
