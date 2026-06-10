import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Sector mapping for Indian stocks
const sectorMapping: Record<string, string> = {
  INFOSY: 'IT',
  SWIGGY: 'Logistics & Food',
  TCS: 'IT',
  RELIANCE: 'Energy',
  HDFC: 'Finance',
  ICICI: 'Banking',
  BAJAJFINSV: 'Financial Services',
  BAJFINANCE: 'Financial Services',
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
  HDFCBANK: 'Financial Services',
  ICICIBANK: 'Financial Services',
  VEDL: 'Metals & Mining',
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

async function populateSectorsWithSQL() {
  try {
    console.log('Starting sector population using a single SQL join update...\n')

    // Get all unique stocks
    const stocks = await prisma.stock.findMany({
      select: { id: true, symbol: true, name: true },
    })

    console.log(`Found ${stocks.length} stocks to process\n`)

    let defaulted = 0
    const explicitMappings = stocks
      .filter((stock) => sectorMapping[stock.symbol])
      .map((stock) => ({
        symbol: stock.symbol,
        sector: sectorMapping[stock.symbol],
      }))

    const explicitCase = explicitMappings
      .map(
        (mapping) =>
          `WHEN s.symbol = '${mapping.symbol.replace(/'/g, "''")}' THEN '${mapping.sector.replace(/'/g, "''")}'`
      )
      .join('\n            ')

    const heuristicCase = `
      WHEN s.symbol ~* '(BANK|BANKING|FINANCE|NBFC|CREDIT)' OR COALESCE(s.name, '') ~* '(BANK|BANKING|FINANCE|NBFC|CREDIT)' THEN 'Banking & Finance'
      WHEN s.symbol ~* '(TECH|SOFT|\bIT\b|COMPUTER|DIGITAL)' OR COALESCE(s.name, '') ~* '(TECH|SOFT|\bIT\b|COMPUTER|DIGITAL)' THEN 'IT'
      WHEN s.symbol ~* '(PHARMA|DRUG|HEALTH|MEDICINE|BIOTECH)' OR COALESCE(s.name, '') ~* '(PHARMA|DRUG|HEALTH|MEDICINE|BIOTECH)' THEN 'Pharma'
      WHEN s.symbol ~* '(AUTO|MOTOR|CAR|TRUCK|VEHICLE)' OR COALESCE(s.name, '') ~* '(AUTO|MOTOR|CAR|TRUCK|VEHICLE)' THEN 'Automobile'
      WHEN s.symbol ~* '(POWER|ENERGY|COAL|GAS|OIL|SOLAR)' OR COALESCE(s.name, '') ~* '(POWER|ENERGY|COAL|GAS|OIL|SOLAR)' THEN 'Energy & Power'
      WHEN s.symbol ~* '(TELECOM|MOBILE|COMM|WIRELESS)' OR COALESCE(s.name, '') ~* '(TELECOM|MOBILE|COMM|WIRELESS)' THEN 'Telecom'
      WHEN s.symbol ~* '(FOOD|BEVERAGE|CONSUMER|PERSONAL|CARE)' OR COALESCE(s.name, '') ~* '(FOOD|BEVERAGE|CONSUMER|PERSONAL|CARE)' THEN 'FMCG'
      WHEN s.symbol ~* '(REAL|ESTATE|PROPERTY|HOUSING|LAND)' OR COALESCE(s.name, '') ~* '(REAL|ESTATE|PROPERTY|HOUSING|LAND)' THEN 'Real Estate'
      WHEN s.symbol ~* '(CONSTRUCT|INFRA)' OR COALESCE(s.name, '') ~* '(CONSTRUCT|INFRA)' THEN 'Construction'
      WHEN s.symbol ~* '(STEEL|METAL|ALUMINUM|COPPER)' OR COALESCE(s.name, '') ~* '(STEEL|METAL|ALUMINUM|COPPER)' THEN 'Metals'
      WHEN s.symbol ~* 'CEMENT' OR COALESCE(s.name, '') ~* 'CEMENT' THEN 'Cement'
      WHEN s.symbol ~* '(RETAIL|STORE)' OR COALESCE(s.name, '') ~* '(RETAIL|STORE)' THEN 'Retail'
      WHEN s.symbol ~* '(MEDIA|NEWS|BROADCAST)' OR COALESCE(s.name, '') ~* '(MEDIA|NEWS|BROADCAST)' THEN 'Media'
      ELSE 'Others'
    `

    const query = `
      UPDATE "StockPrice" sp
      SET sector = CASE
        ${explicitCase}
        ${heuristicCase}
      END
      FROM "Stock" s
      WHERE sp."stockId" = s.id
    `

    const totalUpdated = await prisma.$executeRawUnsafe(query)

    console.log(`\n✅ Completed! Updated ${totalUpdated} total rows`)
    console.log(`📊 ${defaulted} sectors were guessed based on name patterns\n`)

    // Get distribution
    const result = await prisma.$queryRaw<any[]>`
      SELECT sector, COUNT(*) as count 
      FROM "StockPrice" 
      WHERE sector IS NOT NULL 
      GROUP BY sector 
      ORDER BY count DESC
    `

    console.log('Sector distribution:')
    result.forEach((row: any) => {
      console.log(`  ${row.sector || 'NULL'}: ${row.count} rows`)
    })
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

populateSectorsWithSQL()
