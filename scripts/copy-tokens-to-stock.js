// One-time migration: copies angelToken from Instrument table → Stock.angelToken
// Safe to run multiple times — only updates rows where angelToken is not already set.
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
const env = fs.readFileSync(envPath, 'utf8')
const match = env.match(/DATABASE_URL="([^"]+)"/)
if (!match) { console.error('DATABASE_URL not found in .env'); process.exit(1) }

const client = new Client({ connectionString: match[1] })

// Full known token map (ec2 list + any dynamically resolved ones)
const KNOWN_TOKENS = {
  NIFTY:      { token: '99926000', exchange: 'NSE' },
  RELIANCE:   { token: '2885',     exchange: 'NSE' },
  HDFCBANK:   { token: '1333',     exchange: 'NSE' },
  ICICIBANK:  { token: '4963',     exchange: 'NSE' },
  SBIN:       { token: '3045',     exchange: 'NSE' },
  WIPRO:      { token: '3787',     exchange: 'NSE' },
  ADANIPOWER: { token: '17388',    exchange: 'NSE' },
  VEDL:       { token: '3063',     exchange: 'NSE' },
  BAJFINANCE: { token: '317',      exchange: 'NSE' },
  ETERNAL:    { token: '5097',     exchange: 'NSE' },
  SWIGGY:     { token: '27066',    exchange: 'NSE' },
  REDINGTON:  { token: '14255',    exchange: 'NSE' },
  MIFL:       { token: '537800',   exchange: 'BSE' },
  ANGELONE:   { token: '20374',    exchange: 'NSE' },
  ASIANPAINT: { token: '236',      exchange: 'NSE' },
  CDSL:       { token: '21174',    exchange: 'NSE' },
  INFY:       { token: '1594',     exchange: 'NSE' },
  TCS:        { token: '11536',    exchange: 'NSE' },
}

async function main() {
  await client.connect()
  console.log('Connected to DB\n')

  // Step 1: Copy from Instrument table
  const instr = await client.query(
    'SELECT symbol, "angelToken", exchange FROM "Instrument" WHERE "angelToken" IS NOT NULL'
  )
  console.log(`Instrument rows with tokens: ${instr.rows.length}`)

  let fromInstrument = 0
  for (const row of instr.rows) {
    const res = await client.query(
      'UPDATE "Stock" SET "angelToken" = $1, exchange = $2 WHERE UPPER(symbol) = UPPER($3) AND ("angelToken" IS NULL OR "angelToken" = \'\')',
      [row.angelToken, row.exchange, row.symbol]
    )
    if (res.rowCount > 0) { fromInstrument++; console.log(`  ✓ ${row.symbol} → ${row.angelToken} (${row.exchange})`) }
  }

  // Step 2: Fill any remaining gaps from hardcoded KNOWN_TOKENS
  let fromFallback = 0
  for (const [symbol, info] of Object.entries(KNOWN_TOKENS)) {
    const res = await client.query(
      'UPDATE "Stock" SET "angelToken" = $1, exchange = $2 WHERE UPPER(symbol) = UPPER($3) AND ("angelToken" IS NULL OR "angelToken" = \'\')',
      [info.token, info.exchange, symbol]
    )
    if (res.rowCount > 0) { fromFallback++; console.log(`  ✓ ${symbol} → ${info.token} (${info.exchange}) [fallback]`) }
  }

  // Step 3: Show final state
  console.log('\n─── Final Stock.angelToken state ───')
  const stocks = await client.query('SELECT symbol, exchange, "angelToken" FROM "Stock" ORDER BY symbol')
  for (const s of stocks.rows) {
    const icon = s.angelToken ? '✓' : '✗'
    console.log(`  ${icon} ${s.symbol.padEnd(12)} exchange=${s.exchange.padEnd(4)} token=${s.angelToken || 'MISSING'}`)
  }

  console.log(`\nUpdated from Instrument table: ${fromInstrument}`)
  console.log(`Updated from fallback map:     ${fromFallback}`)
  await client.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
