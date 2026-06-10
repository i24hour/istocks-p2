import { PrismaClient } from '@prisma/client'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') })

const prisma = new PrismaClient()

// Helper function to escape CSV fields
function escapeCSV(value: any): string {
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
function writeArrayToCSV(filename: string, headers: string[], data: any[]): Promise<void> {
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
    const fs = require('fs')
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
    
    // Export Stock Prices
    console.log('\n📈 Exporting StockPrice table...')
    console.log('⏳ This may take a while for large datasets...')
    
    const totalPrices = await prisma.stockPrice.count()
    console.log(`📊 Total records to export: ${totalPrices.toLocaleString()}`)
    
    const stockPrices = await prisma.stockPrice.findMany({
      orderBy: [
        { stockId: 'asc' },
        { timestamp: 'desc' }
      ]
      // No limit - export all data
    })
    
    if (stockPrices.length > 0) {
      const priceHeaders = [
        'id', 'stockId', 'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'sma20', 'sma50', 'sma200', 'ema12', 'ema26',
        'macd', 'macdSignal', 'macdHistogram',
        'adx', 'plusDI', 'minusDI',
        'rsi', 'stochK', 'stochD', 'cci', 'williamsR', 'roc',
        'bbUpper', 'bbMiddle', 'bbLower', 'atr',
        'obv', 'vwap', 'forceIndex', 'adLine',
        'createdAt'
      ]
      
      await writeArrayToCSV('stock_prices.csv', priceHeaders, stockPrices)
      console.log(`✅ Exported ${stockPrices.length} price records to exports/stock_prices.csv`)
    } else {
      console.log('⚠️  No stock prices found')
    }
    
    // Export Stock Insights
    console.log('\n💡 Exporting StockInsight table...')
    const insights = await prisma.stockInsight.findMany({
      orderBy: [
        { stockId: 'asc' },
        { generatedAt: 'desc' }
      ]
    })
    
    if (insights.length > 0) {
      await writeArrayToCSV(
        'stock_insights.csv',
        [
          'id', 'stockId', 'timeframe', 'trend', 'trendStrength',
          'momentum', 'volatility', 'volumeAnalysis',
          'supportLevel', 'resistanceLevel', 'summary', 'generatedAt'
        ],
        insights
      )
      console.log(`✅ Exported ${insights.length} insights to exports/stock_insights.csv`)
    } else {
      console.log('⚠️  No insights found')
    }
    
    // Export Stock Prices with Stock Symbol (joined data)
    console.log('\n🔗 Exporting joined data (Prices with Stock Symbols)...')
    console.log('⏳ This may take a while for large datasets...')
    
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
        { stockId: 'asc' },
        { timestamp: 'desc' }
      ]
      // No limit - export all data
    })
    
    if (pricesWithSymbols.length > 0) {
      const joinedData = pricesWithSymbols.map(price => ({
        symbol: price.stock.symbol,
        stockName: price.stock.name,
        timestamp: price.timestamp,
        open: price.open,
        high: price.high,
        low: price.low,
        close: price.close,
        volume: price.volume,
        rsi: price.rsi,
        macd: price.macd,
        macdSignal: price.macdSignal,
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
        stochK: price.stochK,
        stochD: price.stochD,
        cci: price.cci,
        williamsR: price.williamsR
      }))
      
      await writeArrayToCSV(
        'prices_with_symbols.csv',
        [
          'symbol', 'stockName', 'timestamp', 'open', 'high', 'low', 'close', 'volume',
          'rsi', 'macd', 'macdSignal', 'sma20', 'sma50', 'sma200',
          'ema12', 'ema26', 'bbUpper', 'bbMiddle', 'bbLower',
          'atr', 'adx', 'stochK', 'stochD', 'cci', 'williamsR'
        ],
        joinedData
      )
      console.log(`✅ Exported ${joinedData.length} joined records to exports/prices_with_symbols.csv`)
    }
    
    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('✨ Database export completed successfully!')
    console.log('='.repeat(60))
    console.log(`\n📁 All CSV files are saved in: ${exportsDir}`)
    console.log('\nExported files:')
    console.log('  • stocks.csv - All stock information')
    console.log('  • stock_prices.csv - All price data with technical indicators')
    console.log('  • stock_insights.csv - AI-generated insights')
    console.log('  • prices_with_symbols.csv - Price data with stock symbols (easy to read)')
    console.log('\n💡 Tip: Open these files in Excel, Google Sheets, or any CSV viewer')
    
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
