// Script to convert all UTC timestamps to IST in the database
// Run with: npx ts-node scripts/convert-utc-to-ist.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function convertUTCtoIST() {
  console.log('🕐 Starting UTC to IST conversion...')
  
  // IST is UTC + 5:30 = 330 minutes
  const IST_OFFSET_MINUTES = 330
  
  try {
    // Get total count
    const totalCount = await prisma.stockPrice.count()
    console.log(`📊 Total records to update: ${totalCount}`)
    
    if (totalCount === 0) {
      console.log('No records to update.')
      return
    }

    // Update all timestamps by adding 5:30 hours using raw SQL
    // This is the most efficient way to update all records at once
    console.log('⏳ Updating all timestamps (adding 5:30 hours)...')
    
    const result = await prisma.$executeRaw`
      UPDATE "StockPrice" 
      SET timestamp = timestamp + INTERVAL '5 hours 30 minutes'
    `
    
    console.log(`✅ Updated ${result} records`)
    
    // Verify by showing a sample
    const sample = await prisma.stockPrice.findMany({
      take: 5,
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, close: true }
    })
    
    console.log('\n📋 Sample of updated records (should now be IST):')
    sample.forEach(record => {
      console.log(`  ${record.timestamp.toISOString()} - ₹${record.close}`)
    })
    
    console.log('\n✅ Conversion complete!')
    console.log('⚠️  Note: Make sure your data import scripts now save in IST directly.')
    
  } catch (error) {
    console.error('❌ Error during conversion:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

convertUTCtoIST()
