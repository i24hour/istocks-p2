const { PrismaClient } = require('@prisma/client')
require('dotenv').config()

const prisma = new PrismaClient()

async function checkOct23() {
  try {
    const wipro = await prisma.stock.findUnique({
      where: { symbol: 'WIPRO' }
    })
    
    // Check for October 23, 2025 data
    const oct23Data = await prisma.stockPrice.findMany({
      where: {
        stockId: wipro.id,
        timestamp: {
          gte: new Date('2025-10-23T00:00:00+05:30'),
          lte: new Date('2025-10-23T23:59:59+05:30')
        }
      },
      orderBy: { timestamp: 'asc' }
    })
    
    console.log(`📅 October 23, 2025 data: ${oct23Data.length} records`)
    
    if (oct23Data.length > 0) {
      console.log('\n📊 Sample records:')
      oct23Data.slice(0, 10).forEach(record => {
        console.log(`  ${record.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} - O:₹${record.open} H:₹${record.high} L:₹${record.low} C:₹${record.close}`)
      })
      
      // Find closest to 2:30 PM
      const target = new Date('2025-10-23T14:30:00+05:30')
      const closest = oct23Data.reduce((prev, curr) => {
        return Math.abs(curr.timestamp - target) < Math.abs(prev.timestamp - target) ? curr : prev
      })
      
      console.log(`\n🎯 Closest to 2:30 PM:`)
      console.log(`  ${closest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} - O:₹${closest.open} H:₹${closest.high} L:₹${closest.low} C:₹${closest.close}`)
    } else {
      console.log('❌ No data found for October 23, 2025')
      
      // Check what dates we DO have
      const allDates = await prisma.$queryRaw`
        SELECT DATE(timestamp AT TIME ZONE 'Asia/Kolkata') as date, COUNT(*) as count
        FROM "StockPrice"
        WHERE "stockId" = ${wipro.id}
        GROUP BY DATE(timestamp AT TIME ZONE 'Asia/Kolkata')
        ORDER BY date
        LIMIT 20
      `
      
      console.log('\n📅 Available dates:')
      allDates.forEach(d => {
        console.log(`  ${d.date.toISOString().split('T')[0]}: ${d.count} records`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkOct23()
