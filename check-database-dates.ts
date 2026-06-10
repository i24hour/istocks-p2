import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

async function checkDates() {
  try {
    // Find all stocks
    const stocks = await prisma.stock.findMany()
    console.log('📊 Stocks in database:', stocks.length)
    
    for (const stock of stocks) {
      console.log(`\n🔍 Checking ${stock.symbol} (${stock.name})...`)
      
      // Get the earliest and latest records
      const earliest = await prisma.stockPrice.findFirst({
        where: { stockId: stock.id },
        orderBy: { timestamp: 'asc' }
      })
      
      const latest = await prisma.stockPrice.findFirst({
        where: { stockId: stock.id },
        orderBy: { timestamp: 'desc' }
      })
      
      const count = await prisma.stockPrice.count({
        where: { stockId: stock.id }
      })
      
      if (earliest && latest) {
        console.log(`  ⏰ Earliest: ${earliest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
        console.log(`  ⏰ Latest: ${latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
        console.log(`  📈 Total records: ${count}`)
        
        // Check for October data
        const octoberData = await prisma.stockPrice.count({
          where: {
            stockId: stock.id,
            timestamp: {
              gte: new Date('2025-10-01T00:00:00+05:30'),
              lte: new Date('2025-10-31T23:59:59+05:30')
            }
          }
        })
        console.log(`  🍂 October 2025 records: ${octoberData}`)
        
        // Check for November data
        const novemberData = await prisma.stockPrice.count({
          where: {
            stockId: stock.id,
            timestamp: {
              gte: new Date('2025-11-01T00:00:00+05:30'),
              lte: new Date('2025-11-30T23:59:59+05:30')
            }
          }
        })
        console.log(`  🍁 November 2025 records: ${novemberData}`)
      } else {
        console.log(`  ❌ No price data found`)
      }
    }
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkDates()
