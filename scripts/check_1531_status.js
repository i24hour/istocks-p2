const { PrismaClient } = require('@prisma/client')
require('dotenv').config()

const prisma = new PrismaClient()

function toIst(date) {
  return new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
}

async function main() {
  try {
    const latestGlobal = await prisma.stockPrice.findFirst({
      orderBy: { timestamp: 'desc' },
      include: { stock: { select: { symbol: true } } },
    })

    if (!latestGlobal) {
      console.log(JSON.stringify({ error: 'No StockPrice rows found' }, null, 2))
      return
    }

    const latestIstDate = new Date(new Date(latestGlobal.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const yyyy = latestIstDate.getFullYear()
    const mm = String(latestIstDate.getMonth() + 1).padStart(2, '0')
    const dd = String(latestIstDate.getDate()).padStart(2, '0')
    const latestDateStr = `${yyyy}-${mm}-${dd}`

    const allLatestDay = await prisma.stockPrice.findMany({
      where: {
        timestamp: {
          gte: new Date(`${latestDateStr}T00:00:00+05:30`),
          lte: new Date(`${latestDateStr}T23:59:59+05:30`),
        },
      },
      select: {
        timestamp: true,
        close: true,
        stock: { select: { symbol: true } },
      },
      orderBy: { timestamp: 'desc' },
    })

    const rows1531 = allLatestDay.filter((r) => {
      const t = new Date(r.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
      return t.startsWith('15:31')
    })

    const latestReliance = await prisma.stockPrice.findFirst({
      where: { stock: { symbol: { equals: 'RELIANCE', mode: 'insensitive' } } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
    })

    const response = {
      latestGlobal: {
        symbol: latestGlobal.stock.symbol,
        timestampUTC: latestGlobal.timestamp,
        timestampIST: toIst(latestGlobal.timestamp),
        close: latestGlobal.close,
      },
      latestIstDate: latestDateStr,
      latestDayLast10: allLatestDay.slice(0, 10).map((r) => ({
        symbol: r.stock.symbol,
        timestampIST: toIst(r.timestamp),
        close: r.close,
      })),
      at1531: {
        count: rows1531.length,
        sample: rows1531.slice(0, 10).map((r) => ({
          symbol: r.stock.symbol,
          timestampIST: toIst(r.timestamp),
          close: r.close,
        })),
      },
      latestReliance: latestReliance
        ? {
            timestampUTC: latestReliance.timestamp,
            timestampIST: toIst(latestReliance.timestamp),
            open: latestReliance.open,
            high: latestReliance.high,
            low: latestReliance.low,
            close: latestReliance.close,
            volume: latestReliance.volume,
          }
        : null,
    }

    console.log(JSON.stringify(response, null, 2))
  } catch (error) {
    console.error('DB check error:', error.message)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
