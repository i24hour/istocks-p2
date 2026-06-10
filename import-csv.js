const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const prisma = new PrismaClient()

async function importCSV() {
  try {
    console.log('📂 Reading CSV file...')
    
    const csvPath = path.join(__dirname, 'exports', 'stock_prices.csv')
    const csvContent = fs.readFileSync(csvPath, 'utf-8')
    const lines = csvContent.split('\n')
    
    console.log(`📊 Total lines: ${lines.length}`)
    
    // Skip header
    const headers = lines[0].split(',')
    console.log('📋 Headers:', headers.slice(0, 10).join(', '), '...')
    
    // Get WIPRO stock
    const wipro = await prisma.stock.findUnique({
      where: { symbol: 'WIPRO' }
    })
    
    if (!wipro) {
      console.error('❌ WIPRO stock not found in database')
      return
    }
    
    console.log(`✅ Found WIPRO: ${wipro.id}`)
    
    // Delete existing data
    console.log('🗑️  Deleting existing data...')
    await prisma.stockPrice.deleteMany({
      where: { stockId: wipro.id }
    })
    
    console.log('💾 Importing records...')
    let imported = 0
    let batch = []
    const batchSize = 100
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      
      const values = line.split(',')
      
      try {
        const record = {
          stockId: wipro.id,
          timestamp: new Date(values[2]),
          open: parseFloat(values[3]),
          high: parseFloat(values[4]),
          low: parseFloat(values[5]),
          close: parseFloat(values[6]),
          volume: BigInt(values[7]),
          sma20: values[8] ? parseFloat(values[8]) : null,
          sma50: values[9] ? parseFloat(values[9]) : null,
          sma200: values[10] ? parseFloat(values[10]) : null,
          ema12: values[11] ? parseFloat(values[11]) : null,
          ema26: values[12] ? parseFloat(values[12]) : null,
          macd: values[13] ? parseFloat(values[13]) : null,
          macdSignal: values[14] ? parseFloat(values[14]) : null,
          macdHistogram: values[15] ? parseFloat(values[15]) : null,
          adx: values[16] ? parseFloat(values[16]) : null,
          plusDI: values[17] ? parseFloat(values[17]) : null,
          minusDI: values[18] ? parseFloat(values[18]) : null,
          rsi: values[19] ? parseFloat(values[19]) : null,
          stochK: values[20] ? parseFloat(values[20]) : null,
          stochD: values[21] ? parseFloat(values[21]) : null,
          cci: values[22] ? parseFloat(values[22]) : null,
          williamsR: values[23] ? parseFloat(values[23]) : null,
          roc: values[24] ? parseFloat(values[24]) : null,
          bbUpper: values[25] ? parseFloat(values[25]) : null,
          bbMiddle: values[26] ? parseFloat(values[26]) : null,
          bbLower: values[27] ? parseFloat(values[27]) : null,
          atr: values[28] ? parseFloat(values[28]) : null,
          obv: values[29] ? BigInt(values[29]) : null,
          vwap: values[30] ? parseFloat(values[30]) : null,
          forceIndex: values[31] ? parseFloat(values[31]) : null,
          adLine: values[32] ? parseFloat(values[32]) : null,
        }
        
        batch.push(record)
        
        if (batch.length >= batchSize) {
          await prisma.stockPrice.createMany({
            data: batch,
            skipDuplicates: true
          })
          imported += batch.length
          console.log(`  ✓ Imported ${imported} records`)
          batch = []
        }
      } catch (error) {
        console.error(`❌ Error on line ${i}:`, error.message)
      }
    }
    
    // Import remaining batch
    if (batch.length > 0) {
      await prisma.stockPrice.createMany({
        data: batch,
        skipDuplicates: true
      })
      imported += batch.length
    }
    
    console.log(`\n✅ Successfully imported ${imported} records!`)
    
    // Verify
    const count = await prisma.stockPrice.count({
      where: { stockId: wipro.id }
    })
    console.log(`📊 Total records in database: ${count}`)
    
    // Show date range
    const earliest = await prisma.stockPrice.findFirst({
      where: { stockId: wipro.id },
      orderBy: { timestamp: 'asc' }
    })
    
    const latest = await prisma.stockPrice.findFirst({
      where: { stockId: wipro.id },
      orderBy: { timestamp: 'desc' }
    })
    
    if (earliest && latest) {
      console.log(`📅 Date range: ${earliest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} to ${latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

importCSV()
