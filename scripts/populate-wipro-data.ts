import { PrismaClient } from '@prisma/client'
import { angelOneService } from '../src/services/angel-one.service'
import { technicalIndicatorsService } from '../src/services/technical-indicators.service'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const prisma = new PrismaClient()

interface CandleData {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Helper to parse "YYYY-MM-DD HH:mm" string as IST (UTC+5:30)
// This ensures consistency regardless of server timezone (Vercel uses UTC)
function parseDateAtIST(dateStr: string): Date {
  const [datePart, timePart] = dateStr.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)

  // Create UTC date by subtracting 5h 30m from the parsed local time
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30))
}

async function populateWiproData() {
  try {
    console.log('🚀 Starting Wipro data population...')

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

    // Calculate dates for last 1 month (1-minute data)
    // Use recent past dates (last month from today)
    const toDate = new Date()
    toDate.setDate(toDate.getDate() - 1) // Yesterday
    toDate.setHours(15, 30, 0, 0)

    const fromDate = new Date(toDate)
    fromDate.setDate(fromDate.getDate() - 60) // 60 days ago (2 months) to get October data
    fromDate.setHours(9, 15, 0, 0)

    const formatDate = (date: Date) => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hours}:${minutes}`
    }

    console.log(`📅 Fetching 1-MINUTE data from ${formatDate(fromDate)} to ${formatDate(toDate)}`)
    console.log('⚠️  This will fetch A LOT of data (1-minute candles for 1 month)')
    console.log('⏱️  Estimated: ~7,500 records (375 minutes per day × 20 trading days)')

    // Fetch historical data from Angel One
    console.log('📊 Fetching data from Angel One API...')
    const historicalData = await angelOneService.getWiproData(
      formatDate(fromDate),
      formatDate(toDate),
      'ONE_MINUTE'  // Changed to 1-minute data
    )

    if (!historicalData || !historicalData.data || !historicalData.data.data) {
      console.error('❌ No data received from Angel One API')
      console.log('Response:', JSON.stringify(historicalData, null, 2))

      // Use mock data if API fails
      console.log('📝 Using mock data instead...')
      return await populateMockData(wipro.id)
    }

    const candles: CandleData[] = historicalData.data.data.map((candle: any[]) => ({
      timestamp: candle[0],
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseInt(candle[5]),
    }))

    console.log(`✅ Received ${candles.length} data points`)

    // Prepare data for technical indicators
    const priceData = candles.map(candle => ({
      timestamp: parseDateAtIST(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }))

    // Calculate technical indicators
    console.log('🔢 Calculating technical indicators...')
    const indicators = technicalIndicatorsService.calculateAllIndicators(priceData)

    // Delete existing data for Wipro
    console.log('🗑️  Deleting existing Wipro data...')
    await prisma.stockPrice.deleteMany({
      where: { stockId: wipro.id },
    })

    // Insert new data with indicators (batch insert for better performance)
    console.log('💾 Inserting data into database...')
    console.log(`📊 Total records to insert: ${priceData.length}`)

    const batchSize = 100
    let insertedCount = 0

    for (let i = 0; i < priceData.length; i += batchSize) {
      const batch = priceData.slice(i, i + batchSize)
      const batchData = batch.map((item, index) => ({
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
      console.log(`  Inserted ${insertedCount}/${priceData.length} records (${((insertedCount / priceData.length) * 100).toFixed(1)}%)`)
    }

    console.log(`✅ Successfully inserted ${insertedCount} records`)
    if (priceData.length > 0) {
      console.log(`📈 Data range: ${priceData[0].timestamp.toLocaleString()} to ${priceData[priceData.length - 1].timestamp.toLocaleString()}`)
    }
    console.log('🎉 Wipro 1-minute data population completed!')

  } catch (error) {
    console.error('❌ Error populating Wipro data:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

async function populateMockData(stockId: string) {
  console.log('📝 Generating mock data for last 30 days...')

  const now = new Date()
  const mockData = []
  let basePrice = 244.37

  for (let i = 30; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    date.setHours(15, 30, 0, 0) // Market close time

    // Generate realistic price movements
    const change = (Math.random() - 0.5) * 5
    basePrice = Math.max(basePrice + change, 230)

    const open = basePrice + (Math.random() - 0.5) * 2
    const close = basePrice
    const high = Math.max(open, close) + Math.random() * 2
    const low = Math.min(open, close) - Math.random() * 2
    const volume = Math.floor(40000000 + Math.random() * 20000000)

    mockData.push({
      timestamp: date,
      open,
      high,
      low,
      close,
      volume,
    })
  }

  // Calculate indicators
  const indicators = technicalIndicatorsService.calculateAllIndicators(mockData)

  // Delete existing data
  await prisma.stockPrice.deleteMany({
    where: { stockId },
  })

  // Insert mock data
  for (let i = 0; i < mockData.length; i++) {
    await prisma.stockPrice.create({
      data: {
        stockId,
        timestamp: mockData[i].timestamp,
        open: mockData[i].open,
        high: mockData[i].high,
        low: mockData[i].low,
        close: mockData[i].close,
        volume: BigInt(mockData[i].volume),
        ...indicators[i],
      },
    })
  }

  console.log(`✅ Successfully inserted ${mockData.length} mock records`)
  console.log('🎉 Mock data population completed!')
}

// Run the script
populateWiproData()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
