import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NSE_BASE_URL = 'https://www.nseindia.com'
const NSE_QUOTE_URL = 'https://www.nseindia.com/api/quote-equity?symbol='

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchIndustry(symbol: string): Promise<string | null> {
  const url = `${NSE_QUOTE_URL}${encodeURIComponent(symbol)}`
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `${NSE_BASE_URL}/`,
    Origin: NSE_BASE_URL,
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await sleep(500 * attempt)
          continue
        }
        return null
      }

      const payload = (await response.json()) as any
      const industry =
        payload?.info?.industry ?? payload?.metadata?.industry ?? null

      if (typeof industry === 'string' && industry.trim()) {
        return industry.trim()
      }

      return null
    } catch {
      if (attempt < 3) {
        await sleep(500 * attempt)
        continue
      }
      return null
    }
  }

  return null
}

async function main() {
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS sector VARCHAR(255);'
    )

    const stocks = await prisma.stock.findMany({
      where: { sector: 'Miscellaneous' },
      select: { id: true, symbol: true, name: true, sector: true },
      orderBy: { symbol: 'asc' },
    })

    console.log(`Found ${stocks.length} Miscellaneous stocks to research`)

    let updated = 0
    let unresolved = 0
    const batchSize = 20

    for (let index = 0; index < stocks.length; index += batchSize) {
      const batch = stocks.slice(index, index + batchSize)

      await Promise.all(
        batch.map(async (stock) => {
          const industry = await fetchIndustry(stock.symbol)
          const sector = industry ?? 'Unclassified'

          if (!industry) {
            unresolved++
          }

          await prisma.stock.update({
            where: { id: stock.id },
            data: { sector },
          })

          updated++
        })
      )

      console.log(
        `Updated ${updated}/${stocks.length} stocks` +
          ` | unresolved: ${unresolved}`
      )
    }

    const stats = await prisma.$queryRaw<Array<{ sector: string | null; count: bigint }>>`
      SELECT sector, COUNT(*)::bigint AS count
      FROM "Stock"
      GROUP BY sector
      ORDER BY count DESC
    `

    console.log('\nFinal sector distribution:')
    for (const row of stats) {
      console.log(`  ${row.sector ?? 'NULL'}: ${row.count.toString()}`)
    }
  } catch (error) {
    console.error('Error populating sectors from NSE:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
