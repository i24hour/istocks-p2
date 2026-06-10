import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Sector mapping for Indian stocks
const sectorMapping: Record<string, string> = {
  INFOSY: 'IT',
  SWIGGY: 'Logistics',
  TCS: 'IT',
  RELIANCE: 'Energy',
  HDFC: 'Finance',
  ICICI: 'Banking',
  BAJAJFINSV: 'Finance',
  WIPRO: 'IT',
  LT: 'Engineering',
  MARUTI: 'Automobile',
  SBIN: 'Banking',
  HCLTECH: 'IT',
  AXISBANK: 'Banking',
  KOTAKBANK: 'Banking',
  SUNPHARMA: 'Pharma',
  TITAN: 'Retail',
  ASIANPAINT: 'Paint & Chemicals',
  POWERGRID: 'Power',
  ITC: 'FMCG',
  ULTRACEMCO: 'Cement',
  BHARTIARTL: 'Telecom',
  NESTLEIND: 'FMCG',
  HEROMOTOCO: 'Automobile',
  SIEMENS: 'Electrical Equipment',
  INDIGO: 'Aviation',
  PAGEIND: 'Rubber & Footwear',
  IDEA: 'Telecom',
  BANKBARODA: 'Banking',
  BHARATGAS: 'Energy',
  DRREDDY: 'Pharma',
  AUBANK: 'Banking',
  BOSCHLTD: 'Automobile Equipment',
  TATASTEEL: 'Metals',
  TATACONSU: 'FMCG',
  TATAMOTORS: 'Automobile',
  TATAPOWER: 'Power',
  TVS: 'Automobile',
  M_M: 'Automobile',
  TECHM: 'IT',
  COFORGE: 'IT',
  PERSISTENT: 'IT',
  MRF: 'Automobile',
  MRPL: 'Refining',
  MSTCLTD: 'Steel Trading',
  MSUMI: 'Automobile Components',
  MTNL: 'Telecom',
  MUTHOOTFIN: 'Finance',
  NAUKRI: 'IT Services',
  NAZARA: 'Gaming',
  NBCC: 'Construction',
  NCC: 'Construction',
  NDTV: 'Media',
}

// Function to guess sector based on stock name/symbol patterns
function guessSector(symbol: string, name?: string): string {
  const combined = (symbol + ' ' + (name || '')).toUpperCase()

  // Finance & Banking
  if (
    combined.includes('BANK') ||
    combined.includes('BANKING') ||
    combined.includes('FINANCE') ||
    combined.includes('FIN') ||
    combined.includes('NBFC') ||
    combined.includes('CREDIT')
  ) {
    return 'Banking & Finance'
  }

  // IT & Tech
  if (
    combined.includes('TECH') ||
    combined.includes('SOFT') ||
    combined.includes('IT') ||
    combined.includes('COMPUTER') ||
    combined.includes('DIGITAL')
  ) {
    return 'IT'
  }

  // Pharma
  if (
    combined.includes('PHARMA') ||
    combined.includes('DRUG') ||
    combined.includes('HEALTH') ||
    combined.includes('MEDICINE') ||
    combined.includes('BIOTECH')
  ) {
    return 'Pharma'
  }

  // Automobile
  if (
    combined.includes('AUTO') ||
    combined.includes('MOTOR') ||
    combined.includes('CAR') ||
    combined.includes('TRUCK') ||
    combined.includes('VEHICLE')
  ) {
    return 'Automobile'
  }

  // Energy
  if (
    combined.includes('POWER') ||
    combined.includes('ENERGY') ||
    combined.includes('COAL') ||
    combined.includes('GAS') ||
    combined.includes('OIL') ||
    combined.includes('SOLAR')
  ) {
    return 'Energy & Power'
  }

  // Telecom
  if (
    combined.includes('TELECOM') ||
    combined.includes('MOBILE') ||
    combined.includes('COMM') ||
    combined.includes('WIRELESS')
  ) {
    return 'Telecom'
  }

  // FMCG
  if (
    combined.includes('FOOD') ||
    combined.includes('BEVERAGE') ||
    combined.includes('CONSUMER') ||
    combined.includes('PERSONAL') ||
    combined.includes('CARE')
  ) {
    return 'FMCG'
  }

  // Real Estate
  if (
    combined.includes('REAL') ||
    combined.includes('ESTATE') ||
    combined.includes('PROPERTY') ||
    combined.includes('HOUSING') ||
    combined.includes('LAND')
  ) {
    return 'Real Estate'
  }

  // Construction
  if (combined.includes('CONSTRUCT') || combined.includes('INFRA')) {
    return 'Construction'
  }

  // Metals
  if (
    combined.includes('STEEL') ||
    combined.includes('METAL') ||
    combined.includes('ALUMINUM') ||
    combined.includes('COPPER')
  ) {
    return 'Metals'
  }

  // Cement
  if (combined.includes('CEMENT')) {
    return 'Cement'
  }

  // Retail
  if (combined.includes('RETAIL') || combined.includes('STORE')) {
    return 'Retail'
  }

  // Media
  if (
    combined.includes('MEDIA') ||
    combined.includes('NEWS') ||
    combined.includes('BROADCAST')
  ) {
    return 'Media'
  }

  // Default
  return 'Others'
}

async function populateSectors() {
  try {
    console.log('Starting sector population...\n')

    // Get all unique stocks
    const stocks = await prisma.stock.findMany({
      select: { id: true, symbol: true, name: true },
    })

    console.log(`Found ${stocks.length} stocks to process\n`)

    let updated = 0
    let defaulted = 0

    for (const stock of stocks) {
      let sector = sectorMapping[stock.symbol]

      if (!sector) {
        sector = guessSector(stock.symbol, stock.name)
        defaulted++
        console.log(
          `ℹ️  ${stock.symbol} (${stock.name}) -> ${sector} (guessed)`
        )
      } else {
        console.log(`✓ ${stock.symbol} (${stock.name}) -> ${sector}`)
      }

      // Update all price records for this stock
      const result = await prisma.stockPrice.updateMany({
        where: { stockId: stock.id },
        data: { sector },
      })

      updated += result.count
    }

    console.log(
      `\n✅ Populated ${updated} rows with sector information`
    )
    console.log(
      `📊 ${defaulted} sectors were guessed based on name patterns\n`
    )

    const sectorStats = await prisma.stockPrice.groupBy({
      by: ['sector'],
      _count: true,
      orderBy: { _count: { stockId: 'desc' } },
    })

    console.log('Sector distribution:')
    sectorStats.forEach((stat) => {
      console.log(`  ${stat.sector || 'NULL'}: ${stat._count} rows`)
    })
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

populateSectors()
