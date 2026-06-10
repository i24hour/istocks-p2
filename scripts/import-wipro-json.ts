import { PrismaClient } from '@prisma/client'
import { technicalIndicatorsService } from '../src/services/technical-indicators.service'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function importWiproData() {
  try {
    console.log('🚀 Starting Wipro data import from JSON...')

    // Read JSON file (check both locations)
    let jsonPath = path.join(process.cwd(), 'wipro_1min_data.json')
    
    if (!fs.existsSync(jsonPath)) {
      jsonPath = path.join(__dirname, 'wipro_1min_data.json')
    }
    
    if (!fs.existsSync(jsonPath)) {
      console.error(`❌ File not found in either location`)
      console.log('\n📝 Please run the Python script first:')
      console.log('   python3 scripts/fetch-wipro-python.py')
      process.exit(1)
    }
    
    console.log(`📁 Reading from: ${jsonPath}`)

    const rawData = fs.readFileSync(jsonPath, 'utf-8')
    const candles = JSON.parse(rawData)

    console.log(`✅ Loaded ${candles.length} records from JSON`)

    // Create or find Wipro stock
    const wipro = await prisma.stock.upsert({
      where: { symbol: 'WIPRO' },
      update: {},
      create: {
        symbol: 'WIPRO',
        name: 'Wipro',
        exchange: 'NSE',
      },
    })

    console.log('✅ Wipro stock created/found:', wipro.id)

    // Prepare data for technical indicators
    const priceData = candles.map((candle: any[]) => ({
      timestamp: new Date(candle[0]),
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseInt(candle[5]),
    }))

    console.log(`📊 Data range: ${priceData[0].timestamp.toLocaleString()} to ${priceData[priceData.length - 1].timestamp.toLocaleString()}`)

    // Calculate technical indicators
    console.log('🔢 Calculating technical indicators...')
    const indicators = technicalIndicatorsService.calculateAllIndicators(priceData)

    // Delete existing data for Wipro
    console.log('🗑️  Deleting existing Wipro data...')
    await prisma.stockPrice.deleteMany({
      where: { stockId: wipro.id },
    })

    // Insert new data with indicators (batch insert)
    console.log('💾 Inserting data into database...')
    console.log(`📊 Total records to insert: ${priceData.length}`)
    
    const batchSize = 100
    let insertedCount = 0

    for (let i = 0; i < priceData.length; i += batchSize) {
      const batch = priceData.slice(i, i + batchSize)
      const batchData = batch.map((item: any, index: number) => ({
        stockId: wipro.id,
        timestamp: item.timestamp,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: BigInt(item.volume),
        ...indicators[i + index],
      }))

      await prisma.stockPrice.createMany({
        data: batchData,
        skipDuplicates: true,
      })

      insertedCount += batch.length
      const progress = ((insertedCount / priceData.length) * 100).toFixed(1)
      console.log(`  Inserted ${insertedCount}/${priceData.length} records (${progress}%)`)
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} records`)
    console.log(`📈 Data range: ${priceData[0].timestamp.toLocaleString()} to ${priceData[priceData.length - 1].timestamp.toLocaleString()}`)
    console.log('🎉 Wipro 1-minute data import completed!')

    // Show some stats
    const stats = await prisma.stockPrice.aggregate({
      where: { stockId: wipro.id },
      _count: true,
      _avg: {
        close: true,
        volume: true,
      },
      _min: {
        timestamp: true,
        close: true,
      },
      _max: {
        timestamp: true,
        close: true,
      },
    })

    console.log('\n📊 Database Statistics:')
    console.log(`   Total records: ${stats._count}`)
    console.log(`   Date range: ${stats._min.timestamp?.toLocaleString()} to ${stats._max.timestamp?.toLocaleString()}`)
    console.log(`   Price range: ₹${stats._min.close?.toFixed(2)} to ₹${stats._max.close?.toFixed(2)}`)
    console.log(`   Average price: ₹${stats._avg.close?.toFixed(2)}`)

  } catch (error) {
    console.error('❌ Error importing Wipro data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the import
importWiproData()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
