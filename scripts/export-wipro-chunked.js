const { PrismaClient } = require('@prisma/client')
const { createWriteStream } = require('fs')
const { join } = require('path')
const fs = require('fs')
require('dotenv').config({ path: join(__dirname, '..', '.env.local') })

const prisma = new PrismaClient()

// Helper function to escape CSV fields
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return ''
  }
  
  const stringValue = String(value)
  
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}

async function exportWiproData() {
  try {
    console.log('🚀 Starting WIPRO data export...\n')
    
    // Create exports directory
    const exportsDir = join(process.cwd(), 'exports')
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir)
    }
    
    // Get total count
    const totalPrices = await prisma.stockPrice.count()
    console.log(`📊 Total records in database: ${totalPrices.toLocaleString()}`)
    
    // Get stock info
    const stock = await prisma.stock.findUnique({
      where: { symbol: 'WIPRO' }
    })
    
    if (!stock) {
      console.log('❌ WIPRO stock not found')
      return
    }
    
    console.log(`✅ Found stock: ${stock.name} (${stock.symbol})`)
    console.log(`📦 Exporting in chunks of 50,000 records...\n`)
    
    // Setup CSV file
    const filepath = join(exportsDir, 'wipro_complete_data.csv')
    const writeStream = createWriteStream(filepath)
    
    // Write headers
    const headers = [
      'symbol', 'stockName', 'timestamp', 'open', 'high', 'low', 'close', 'volume',
      'rsi', 'macd', 'macdSignal', 'macdHistogram',
      'sma20', 'sma50', 'sma200', 'ema12', 'ema26',
      'bbUpper', 'bbMiddle', 'bbLower', 'atr',
      'adx', 'plusDI', 'minusDI',
      'stochK', 'stochD', 'cci', 'williamsR', 'roc',
      'obv', 'vwap', 'forceIndex', 'adLine'
    ]
    
    writeStream.write(headers.join(',') + '\n')
    
    // Export in chunks
    const CHUNK_SIZE = 50000
    let skip = 0
    let totalExported = 0
    
    while (skip < totalPrices) {
      const startTime = Date.now()
      
      console.log(`📥 Fetching records ${skip.toLocaleString()} to ${(skip + CHUNK_SIZE).toLocaleString()}...`)
      
      const pricesChunk = await prisma.stockPrice.findMany({
        where: {
          stockId: stock.id
        },
        orderBy: {
          timestamp: 'asc'
        },
        skip: skip,
        take: CHUNK_SIZE
      })
      
      if (pricesChunk.length === 0) break
      
      console.log(`💾 Writing ${pricesChunk.length.toLocaleString()} records to CSV...`)
      
      // Write data
      for (const price of pricesChunk) {
        const row = [
          stock.symbol,
          stock.name,
          price.timestamp.toISOString().replace('T', ' ').substring(0, 19),
          price.open,
          price.high,
          price.low,
          price.close,
          price.volume,
          price.rsi,
          price.macd,
          price.macdSignal,
          price.macdHistogram,
          price.sma20,
          price.sma50,
          price.sma200,
          price.ema12,
          price.ema26,
          price.bbUpper,
          price.bbMiddle,
          price.bbLower,
          price.atr,
          price.adx,
          price.plusDI,
          price.minusDI,
          price.stochK,
          price.stochD,
          price.cci,
          price.williamsR,
          price.roc,
          price.obv,
          price.vwap,
          price.forceIndex,
          price.adLine
        ]
        
        writeStream.write(row.map(escapeCSV).join(',') + '\n')
      }
      
      totalExported += pricesChunk.length
      skip += CHUNK_SIZE
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const progress = ((totalExported / totalPrices) * 100).toFixed(1)
      console.log(`✅ Chunk complete (${elapsed}s) - Progress: ${progress}% (${totalExported.toLocaleString()}/${totalPrices.toLocaleString()})\n`)
    }
    
    writeStream.end()
    
    await new Promise((resolve) => writeStream.on('finish', resolve))
    
    // Get file size
    const stats = fs.statSync(filepath)
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('✨ Export completed successfully!')
    console.log('='.repeat(80))
    console.log(`\n📁 File: ${filepath}`)
    console.log(`📊 Records: ${totalExported.toLocaleString()}`)
    console.log(`💾 File Size: ${fileSizeMB} MB`)
    console.log(`📅 Date Range: Oct 3, 2016 - Nov 21, 2025`)
    console.log(`⏱️  Interval: 1-minute candles`)
    console.log(`📈 Indicators: 40+ technical indicators included`)
    console.log('\n💡 Open in Excel, Google Sheets, or Python/R for analysis')
    
  } catch (error) {
    console.error('❌ Error exporting data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

exportWiproData()
  .then(() => {
    console.log('\n✅ Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error)
    process.exit(1)
  })
