const { PrismaClient } = require('@prisma/client')
require('dotenv').config()

const prisma = new PrismaClient()

async function checkDatabase() {
  try {
    console.log('🔍 Checking database...\n')
    
    // Count stocks
    const stockCount = await prisma.stock.count()
    console.log(`📊 Total Stocks: ${stockCount}`)
    
    // Get all stocks
    const stocks = await prisma.stock.findMany()
    
    for (const stock of stocks) {
      console.log(`\n📈 Stock: ${stock.symbol} (${stock.name})`)
      
      // Count price records
      const priceCount = await prisma.stockPrice.count({
        where: { stockId: stock.id }
      })
      console.log(`   Total price records: ${priceCount}`)
      
      if (priceCount > 0) {
        // Get earliest record
        const earliest = await prisma.stockPrice.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'asc' }
        })
        
        // Get latest record
        const latest = await prisma.stockPrice.findFirst({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'desc' }
        })
        
        console.log(`   Earliest: ${earliest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
        console.log(`   Latest: ${latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
        
        // Sample a few records
        const samples = await prisma.stockPrice.findMany({
          where: { stockId: stock.id },
          orderBy: { timestamp: 'desc' },
          take: 5
        })
        
        console.log(`\n   📌 Sample records (last 5):`)
        samples.forEach(s => {
          console.log(`      ${s.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} - Close: ₹${s.close}`)
        })
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

checkDatabase()
