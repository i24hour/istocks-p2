/**
 * Seed Index Stocks
 * Inserts/upserts all major Nifty, BSE, and global index symbols into the Stock table.
 * Run with: npx tsx scripts/seed-index-stocks.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const INDEX_STOCKS = [
  // ── NSE broad market ──────────────────────────────────────────────────────
  { symbol: 'NIFTY50',            name: 'Nifty 50',                       exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTY100',           name: 'Nifty 100',                      exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTY200',           name: 'Nifty 200',                      exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTY500',           name: 'Nifty 500',                      exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYNEXT50',        name: 'Nifty Next 50',                  exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYTOTALMARKET',   name: 'Nifty Total Market',             exchange: 'NSE',    sector: 'Index' },
  // ── NSE midcap / smallcap / microcap ──────────────────────────────────────
  { symbol: 'NIFTYMIDCAP50',      name: 'Nifty Midcap 50',                exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMIDCAP100',     name: 'Nifty Midcap 100',               exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMIDCAP150',     name: 'Nifty Midcap 150',               exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMIDSMALLCAP400',name: 'Nifty Midsmallcap 400',          exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYSMALLCAP50',    name: 'Nifty Smallcap 50',              exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYSMALLCAP100',   name: 'Nifty Smallcap 100',             exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYSMALLCAP250',   name: 'Nifty Smallcap 250',             exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMICROCAP250',   name: 'Nifty Microcap 250',             exchange: 'NSE',    sector: 'Index' },
  // ── NSE sectoral ──────────────────────────────────────────────────────────
  { symbol: 'BANKNIFTY',          name: 'Nifty Bank (Bank Nifty)',        exchange: 'NSE',    sector: 'Index' },
  { symbol: 'FINNIFTY',           name: 'Nifty Financial Services',       exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYIT',            name: 'Nifty IT',                       exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYPHARMA',        name: 'Nifty Pharma',                   exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYAUTO',          name: 'Nifty Auto',                     exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYFMCG',          name: 'Nifty FMCG',                     exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYREALTY',        name: 'Nifty Realty',                   exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMETAL',         name: 'Nifty Metal',                    exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYENERGY',        name: 'Nifty Energy',                   exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMEDIA',         name: 'Nifty Media',                    exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYINFRA',         name: 'Nifty Infrastructure',           exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYPSE',           name: 'Nifty PSE',                      exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYMNC',           name: 'Nifty MNC',                      exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYPVTBANK',       name: 'Nifty Private Bank',             exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYPSUBANK',       name: 'Nifty PSU Bank',                 exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYCONSMRDUR',     name: 'Nifty Consumer Durables',        exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYHEALTHCARE',    name: 'Nifty Healthcare',               exchange: 'NSE',    sector: 'Index' },
  { symbol: 'NIFTYOILGAS',        name: 'Nifty Oil & Gas',                exchange: 'NSE',    sector: 'Index' },
  // ── Volatility ────────────────────────────────────────────────────────────
  { symbol: 'INDIAVIX',           name: 'India VIX',                      exchange: 'NSE',    sector: 'Index' },
  // ── BSE ───────────────────────────────────────────────────────────────────
  { symbol: 'SENSEX',             name: 'BSE Sensex',                     exchange: 'BSE',    sector: 'Index' },
  { symbol: 'BSE500',             name: 'BSE 500',                        exchange: 'BSE',    sector: 'Index' },
  { symbol: 'BSEMIDCAP',         name: 'BSE Midcap',                     exchange: 'BSE',    sector: 'Index' },
  { symbol: 'BSESMALLCAP',        name: 'BSE Smallcap',                   exchange: 'BSE',    sector: 'Index' },
  // ── Global ────────────────────────────────────────────────────────────────
  { symbol: 'DOWJONES',           name: 'Dow Jones Industrial Average',   exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'NASDAQ',             name: 'NASDAQ Composite',               exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'SP500',              name: 'S&P 500',                        exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'FTSE100',            name: 'FTSE 100',                       exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'DAX',                name: 'DAX (Germany)',                  exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'NIKKEI225',          name: 'Nikkei 225',                     exchange: 'GLOBAL', sector: 'Index' },
  { symbol: 'HANGSENG',           name: 'Hang Seng',                      exchange: 'GLOBAL', sector: 'Index' },
]

async function main() {
  console.log(`🌱 Seeding ${INDEX_STOCKS.length} index symbols into Stock table...\n`)

  let created = 0, updated = 0, errors = 0

  for (const stock of INDEX_STOCKS) {
    try {
      const existing = await prisma.stock.findUnique({ where: { symbol: stock.symbol } })
      if (existing) {
        await prisma.stock.update({
          where: { symbol: stock.symbol },
          data: { name: stock.name, exchange: stock.exchange, sector: stock.sector },
        })
        console.log(`🔄 Updated : ${stock.symbol} — ${stock.name}`)
        updated++
      } else {
        await prisma.stock.create({ data: stock })
        console.log(`✅ Created : ${stock.symbol} — ${stock.name}`)
        created++
      }
    } catch (e) {
      console.error(`❌ Error   : ${stock.symbol} — ${e instanceof Error ? e.message : e}`)
      errors++
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`Summary: ${created} created, ${updated} updated, ${errors} errors`)
  await prisma.$disconnect()
  process.exit(errors > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
