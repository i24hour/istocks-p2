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
  
  // If the value contains comma, quote, or newline, wrap it in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}

// Helper function to write array to CSV
function writeArrayToCSV(filename, headers, data) {
  return new Promise((resolve, reject) => {
    const filepath = join(process.cwd(), 'exports', filename)
    const writeStream = createWriteStream(filepath)
    
    writeStream.on('error', reject)
    writeStream.on('finish', resolve)
    
    // Write headers
    writeStream.write(headers.join(',') + '\n')
    
    // Write data rows
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header]
        return escapeCSV(value)
      })
      writeStream.write(values.join(',') + '\n')
    }
    
    writeStream.end()
  })
}

async function exportDatabase() {
  try {
    console.log('🚀 Starting database export...\n')
    
    // Create exports directory if it doesn't exist
    const exportsDir = join(process.cwd(), 'exports')
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir)
    }
    
    // Export Stocks
    console.log('📊 Exporting Stocks table...')
    const stocks = await prisma.stock.findMany({
      orderBy: { symbol: 'asc' }
    })
    
    if (stocks.length > 0) {
      await writeArrayToCSV(
        'stocks.csv',
        ['id', 'symbol', 'name', 'exchange', 'createdAt', 'updatedAt'],
        stocks
      )
      console.log(`✅ Exported ${stocks.length} stocks to exports/stocks.csv`)
    } else {
      console.log('⚠️  No stocks found')
    }
    
    // Export Stock Prices with Stock Symbol (joined data) - Most useful!
    console.log('\n🔗 Exporting WIPRO price data with all indicators...')
    console.log('⏳ This will take a few minutes for 840K records...')
    
    const totalPrices = await prisma.stockPrice.count()
    console.log(`📊 Total records in database: ${totalPrices.toLocaleString()}`)
    
    const pricesWithSymbols = await prisma.stockPrice.findMany({
      include: {
        stock: {
          select: {
            symbol: true,
            name: true
          }
        }
      },
      orderBy: [
        { timestamp: 'asc' }  // Chronological order
      ]
    })
    
    console.log(`📥 Fetched ${pricesWithSymbols.length.toLocaleString()} records from database`)
    
    if (pricesWithSymbols.length > 0) {
      const joinedData = pricesWithSymbols.map(price => ({
        symbol: price.stock.symbol,
        stockName: price.stock.name,
        timestamp: price.timestamp.toISOString().replace('T', ' ').substring(0, 19), // Format: YYYY-MM-DD HH:MM:SS
        open: price.open,
        high: price.high,
        low: price.low,
        close: price.close,
        volume: price.volume,
        rsi: price.rsi,
        macd: price.macd,
        macdSignal: price.macdSignal,
        macdHistogram: price.macdHistogram,
        sma20: price.sma20,
        sma50: price.sma50,
        sma200: price.sma200,
        ema12: price.ema12,
        ema26: price.ema26,
        bbUpper: price.bbUpper,
        bbMiddle: price.bbMiddle,
        bbLower: price.bbLower,
        atr: price.atr,
        adx: price.adx,
        plusDI: price.plusDI,
        minusDI: price.minusDI,
        stochK: price.stochK,
        stochD: price.stochD,
        cci: price.cci,
        williamsR: price.williamsR,
        roc: price.roc,
        obv: price.obv,
        vwap: price.vwap,
        forceIndex: price.forceIndex,
        adLine: price.adLine
      }))
      
      console.log('💾 Writing to CSV file...')
      
      await writeArrayToCSV(
        'wipro_complete_data.csv',
        [
          'symbol', 'stockName', 'timestamp', 'open', 'high', 'low', 'close', 'volume',
          'rsi', 'macd', 'macdSignal', 'macdHistogram',
          'sma20', 'sma50', 'sma200', 'ema12', 'ema26',
          'bbUpper', 'bbMiddle', 'bbLower', 'atr',
          'adx', 'plusDI', 'minusDI',
          'stochK', 'stochD', 'cci', 'williamsR', 'roc',
          'obv', 'vwap', 'forceIndex', 'adLine'
        ],
        joinedData
      )
      console.log(`✅ Exported ${joinedData.length.toLocaleString()} records to exports/wipro_complete_data.csv`)
    }
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('✨ Database export completed successfully!')
    console.log('='.repeat(80))
    console.log(`\n📁 All CSV files are saved in: ${exportsDir}`)
    console.log('\nExported files:')
    console.log('  • stocks.csv - Stock information')
    console.log('  • wipro_complete_data.csv - Complete WIPRO data with 40+ indicators (Oct 2016 - Nov 2025)')
    console.log('\n📊 Data Coverage:')
    console.log(`  • Total Records: ${totalPrices.toLocaleString()}`)
    console.log('  • Date Range: Oct 3, 2016 - Nov 21, 2025')
    console.log('  • Interval: 1-minute candles')
    console.log('  • Indicators: OHLCV + RSI, MACD, SMA, EMA, BB, ADX, Stoch, CCI, Williams%R, ROC, OBV, VWAP, etc.')
    console.log('\n💡 Tip: Open wipro_complete_data.csv in Excel, Google Sheets, or Python/R for analysis')
    console.log('     File size: ~100-150 MB')
    
  } catch (error) {
    console.error('❌ Error exporting database:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the export
exportDatabase()
  .then(() => {
    console.log('\n✅ Export script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Export script failed:', error)
    process.exit(1)
  })
