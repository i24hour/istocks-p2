import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const sectorMapping: Record<string, string> = {
  INFOSY: 'IT',
  SWIGGY: 'Logistics & Food',
  TCS: 'IT',
  RELIANCE: 'Energy',
  HDFC: 'Financial Services',
  ICICI: 'Financial Services',
  BAJAJFINSV: 'Financial Services',
  BAJFINANCE: 'Financial Services',
  '3IINFOLTD': 'IT',
  '3MINDIA': 'Industrial Products',
  '5PAISA': 'Financial Services',
  '360ONE': 'Financial Services',
  AAVAS: 'Financial Services',
  ABB: 'Electrical Equipment',
  ABBOTINDIA: 'Pharma',
  ABCAPITAL: 'Financial Services',
  ABFRL: 'Apparel & Retail',
  ABREL: 'Real Estate',
  ABSLAMC: 'Financial Services',
  ACC: 'Cement',
  ACCELYA: 'IT',
  ACE: 'Capital Goods',
  ADANIENSOL: 'Energy & Power',
  ADANIENT: 'Conglomerate',
  ADANIGREEN: 'Energy & Power',
  ADANIPORTS: 'Logistics',
  AEGISLOG: 'Logistics',
  AEGISVOPAK: 'Logistics',
  AEQUS: 'Aerospace',
  AARTIIND: 'Chemicals',
  AARTIPHARM: 'Pharma',
  AARTISURF: 'Chemicals',
  '20MICRONS': 'Metals & Mining',
  '63MOONS': 'IT',
  AAKASH: 'Education',
  AARVI: 'Business Services',
  ABDL: 'Beverages',
  ABGSEC: 'Financial Services',
  ABSLMSCIN: 'ETF / Index Fund',
  ABSLNN50ET: 'ETF / Index Fund',
  ABSLPSE: 'ETF / Index Fund',
  ACCURACY: 'Logistics',
  ACEINTEG: 'Industrial Products',
  ACI: 'Chemicals',
  ACL: 'Chemicals',
  ADOR: 'Industrial Products',
  ADROITINFO: 'IT',
  ADVAIT: 'Industrial Products',
  ADVANIHOTR: 'Hospitality',
  ADVENTHTL: 'Hospitality',
  AEROENTER: 'Aerospace',
  AERONEU: 'Aerospace',
  AETHER: 'Chemicals',
  AFFORDABLE: 'Financial Services',
  AFSL: 'Financial Services',
  AGARIND: 'Chemicals',
  AGARWALEYE: 'Healthcare',
  AGI: 'Industrial Products',
  AGIIL: 'Industrial Products',
  AHCL: 'Healthcare',
  AHLADA: 'Industrial Products',
  AHLUCONT: 'Construction',
  AIAENG: 'Industrial Products',
  AIIL: 'Financial Services',
  AIRAN: 'Business Services',
  AIROLAM: 'Paper & Packaging',
  AJANTPHARM: 'Pharma',
  AJAXENGG: 'Industrial Products',
  AJMERA: 'Real Estate',
  AJOONI: 'FMCG',
  AKASH: 'Education',
  AKG: 'Textile & Apparel',
  AKI: 'Chemicals',
  AKSHAR: 'Real Estate',
  AKSHOPTFBR: 'Media',
  AKUMS: 'Pharma',
  AKZOINDIA: 'Paint & Chemicals',
  ALANKIT: 'Financial Services',
  ALEMBICLTD: 'Pharma',
  ALGOQUANT: 'Financial Services',
  ALICON: 'Industrial Products',
  ALIVUS: 'Pharma',
  ALKALI: 'Chemicals',
  ALKEM: 'Pharma',
  ALLDIGI: 'Business Services',
  ALLTIME: 'Consumer Durables',
  ALMONDZ: 'Financial Services',
  ALOKINDS: 'Textile & Apparel',
  ALPA: 'Textile & Apparel',
  ALPHA: 'Financial Services',
  ALPHAGEO: 'Energy & Power',
  AMAGI: 'Media',
  AMANTA: 'Pharma',
  AMBER: 'Consumer Durables',
  AMBICAAGAR: 'Paper & Packaging',
  AMBIKCO: 'Chemicals',
  AMNPLST: 'Paper & Packaging',
  AMRUTANJAN: 'Healthcare',
  ANANDRATHI: 'Financial Services',
  ANANTRAJ: 'Real Estate',
  ANDHRAPAP: 'Paper & Packaging',
  ANGELONE: 'Financial Services',
  ANIKINDS: 'FMCG',
  ANMOL: 'Financial Services',
  ANTGRAPHIC: 'Media',
  ANTHEM: 'Healthcare',
  ANUP: 'Industrial Products',
  ANURAS: 'Chemicals',
  ASAHIINDIA: 'Glass & Glass Products',
  ASHOKLEY: 'Automobile',
  ARVIND: 'Textile & Apparel',
  ARVINDFASN: 'Apparel & Retail',
  ARVSMART: 'Real Estate',
  AMBUJACEM: 'Cement',
  ASHAPURMIN: 'Metals & Mining',
  ASHIANA: 'Real Estate',
  ASHIMASYN: 'Textile & Apparel',
  ASHOKA: 'Construction',
  ASHOKAMET: 'Metals & Mining',
  ASIANENE: 'Energy & Power',
  ASIANHOTNR: 'Hospitality',
  ASIANTILES: 'Construction Materials',
  ASPINWALL: 'Agri & Commodity Trading',
  ASTEC: 'Chemicals',
  ASTERDM: 'Healthcare',
  ASTRAL: 'Construction Materials',
  ASTRAMICRO: 'Aerospace & Defence',
  ASTRAZEN: 'Pharma',
  ASTRON: 'Industrial Products',
  ATAM: 'Industrial Products',
  ATGL: 'Energy & Power',
  ATHERENERG: 'Automobile',
  ATL: 'Aerospace & Defence',
  ATLANTAA: 'Construction',
  ATLANTAELE: 'Electrical Equipment',
  ATLASCYCLE: 'Automobile',
  ATUL: 'Chemicals',
  AURIONPRO: 'IT',
  AURUM: 'Real Estate',
  AVALON: 'Industrial Products',
  AVANTEL: 'Telecom',
  EXCEL: 'Agro Chemicals',
  AONEGOLD: 'ETF / Index Fund',
  AONESILVER: 'ETF / Index Fund',
  AONETMMQ50: 'ETF / Index Fund',
  AONETOTAL: 'ETF / Index Fund',
  APARINDS: 'Industrial Products',
  APCL: 'Cement',
  APCOTEXIND: 'Chemicals',
  APEX: 'Logistics',
  APLAPOLLO: 'Metals & Mining',
  APLLTD: 'Logistics',
  APOLLOPIPE: 'Industrial Products',
  APOLSINHOT: 'Hospitality',
  APTUS: 'Financial Services',
  ARCHIDPLY: 'Paper & Packaging',
  ARCHIES: 'Retail',
  'ARE&M': 'Energy & Power',
  ARENTERP: 'Real Estate',
  ARFIN: 'Metals & Mining',
  ARIES: 'Chemicals',
  ARIHANTCAP: 'Financial Services',
  ARIHANTSUP: 'Chemicals',
  ARKADE: 'Real Estate',
  ARMANFIN: 'Financial Services',
  AROGRANITE: 'Metals & Mining',
  ARSSBL: 'Construction',
  ARTEMISMED: 'Healthcare',
  ABCOTS: 'FMCG',
  ABLBL: 'Financial Services',
  ACUTAAS: 'Industrial Products',
  ADL: 'Industrial Products',
  ADSL: 'Business Services',
  ADVANCE: 'Financial Services',
  AHLEAST: 'Hospitality',
  AHLADA: 'Industrial Products',
  ALBERTDAVD: 'Education',
  AQYLON: 'Energy & Power',
  ARIS: 'Industrial Products',
  AFCONS: 'Construction',
  AFFLE: 'IT',
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
  TATASTEEL: 'Metals & Mining',
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
  MUTHOOTFIN: 'Financial Services',
  NAUKRI: 'IT Services',
  NAZARA: 'Gaming',
  NBCC: 'Construction',
  NCC: 'Construction',
  NDTV: 'Media',
}

function guessSector(symbol: string, name?: string): string {
  const combined = `${symbol} ${name ?? ''}`.toUpperCase()

  if (
    combined.includes('ETF') ||
    combined.includes('BEES') ||
    combined.includes('INAV') ||
    combined.includes('INDEX') ||
    combined.includes('NIFTY') ||
    combined.includes('LIQUID') ||
    combined.includes('MUTUAL')
  ) {
    return 'ETF / Index Fund'
  }

  if (
    combined.includes('TEST') ||
    combined.includes('DEMO') ||
    combined.includes('DUMMY')
  ) {
    return 'Test / System'
  }

  if (
    combined.includes('BANK') ||
    combined.includes('BANKING') ||
    combined.includes('FINANCE') ||
    combined.includes('AMC') ||
    combined.includes('CAPITAL') ||
    combined.includes('ASSET') ||
    combined.includes('BROKING') ||
    combined.includes('SECURITIES') ||
    combined.includes('HFC') ||
    combined.includes('HOLDING') ||
    combined.includes('INVEST') ||
    combined.includes('WEALTH') ||
    combined.includes('PAISA') ||
    combined.includes('NBFC') ||
    combined.includes('CREDIT')
  ) {
    return 'Financial Services'
  }

  if (
    combined.includes('TECH') ||
    combined.includes('SOFT') ||
    combined.includes(' IT ') ||
    combined.startsWith('IT ') ||
    combined.includes('COMPUTER') ||
    combined.includes('DIGITAL')
  ) {
    return 'IT'
  }

  if (
    combined.includes('CHEM') ||
    combined.includes('SURF') ||
    combined.includes('PIGMENT') ||
    combined.includes('ENZYME') ||
    combined.includes('SPECIALTY') ||
    combined.includes('FLEX') ||
    combined.includes('PACK') ||
    combined.includes('RESIN')
  ) {
    return 'Chemicals'
  }

  if (
    combined.includes('ABB') ||
    combined.includes('ELECT') ||
    combined.includes('ENGINEER') ||
    combined.includes('CAPITAL GOODS') ||
    combined.includes('PUMPS') ||
    combined.includes('CABLE') ||
    combined.includes('WIRE')
  ) {
    return 'Industrial Products'
  }

  if (
    combined.includes('PORT') ||
    combined.includes('LOG') ||
    combined.includes('SHIPP') ||
    combined.includes('FREIGHT') ||
    combined.includes('WAREHOUSE') ||
    combined.includes('COURIER')
  ) {
    return 'Logistics'
  }

  if (
    combined.includes('GREEN') ||
    combined.includes('SOLAR') ||
    combined.includes('RENEW') ||
    combined.includes('POWER') ||
    combined.includes('ENERGY') ||
    combined.includes('OIL') ||
    combined.includes('GAS') ||
    combined.includes('COAL')
  ) {
    return 'Energy & Power'
  }

  if (
    combined.includes('PHARMA') ||
    combined.includes('DRUG') ||
    combined.includes('HEALTH') ||
    combined.includes('MEDICINE') ||
    combined.includes('BIOTECH')
  ) {
    return 'Pharma'
  }

  if (
    combined.includes('HEALTHCARE') ||
    combined.includes('HOSP') ||
    combined.includes('DIAG') ||
    combined.includes('LAB') ||
    combined.includes('CLINIC') ||
    combined.includes('MEDIC')
  ) {
    return 'Healthcare'
  }

  if (
    combined.includes('CONSULT') ||
    combined.includes('SERV') ||
    combined.includes('STAFF') ||
    combined.includes('BPO') ||
    combined.includes('OUTSOURC') ||
    combined.includes('RPO') ||
    combined.includes('HR ')
  ) {
    return 'Business Services'
  }

  if (
    combined.includes('AUTO') ||
    combined.includes('MOTOR') ||
    combined.includes('CAR') ||
    combined.includes('TRUCK') ||
    combined.includes('VEHICLE') ||
    combined.includes('TYRE') ||
    combined.includes('BATTERY') ||
    combined.includes('COMPONENT')
  ) {
    return 'Automobile'
  }

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

  if (
    combined.includes('TELECOM') ||
    combined.includes('MOBILE') ||
    combined.includes('COMM') ||
    combined.includes('WIRELESS')
  ) {
    return 'Telecom'
  }

  if (
    combined.includes('FOOD') ||
    combined.includes('BEVERAGE') ||
    combined.includes('CONSUMER') ||
    combined.includes('PERSONAL') ||
    combined.includes('CARE') ||
    combined.includes('AGRO') ||
    combined.includes('SUGAR') ||
    combined.includes('FERT')
  ) {
    return 'FMCG'
  }

  if (
    combined.includes('TEXT') ||
    combined.includes('FAB') ||
    combined.includes('GARMENT') ||
    combined.includes('APPAREL') ||
    combined.includes('FOOTWEAR') ||
    combined.includes('LEATHER') ||
    combined.includes('COTTON') ||
    combined.includes('YARN') ||
    combined.includes('DENIM')
  ) {
    return 'Textile & Apparel'
  }

  if (
    combined.includes('PAPER') ||
    combined.includes('PACK') ||
    combined.includes('CORR') ||
    combined.includes('BOARD') ||
    combined.includes('FILM') ||
    combined.includes('PLAST')
  ) {
    return 'Paper & Packaging'
  }

  if (
    combined.includes('REAL') ||
    combined.includes('ESTATE') ||
    combined.includes('PROPERTY') ||
    combined.includes('HOUSING') ||
    combined.includes('LAND') ||
    combined.includes('HOTEL') ||
    combined.includes('HOSPITALITY') ||
    combined.includes('RESORT')
  ) {
    return 'Real Estate'
  }

  if (combined.includes('CONSTRUCT') || combined.includes('INFRA')) {
    return 'Construction'
  }

  if (
    combined.includes('STEEL') ||
    combined.includes('METAL') ||
    combined.includes('ALUMINUM') ||
    combined.includes('COPPER') ||
    combined.includes('ZINC') ||
    combined.includes('MINERAL') ||
    combined.includes('MINE')
  ) {
    return 'Metals & Mining'
  }

  if (combined.includes('CEMENT')) {
    return 'Cement'
  }

  if (
    combined.includes('HOTEL') ||
    combined.includes('RESORT') ||
    combined.includes('TOUR') ||
    combined.includes('TRAVEL') ||
    combined.includes('LEISURE')
  ) {
    return 'Hospitality'
  }

  if (
    combined.includes('RETAIL') ||
    combined.includes('STORE') ||
    combined.includes('APPAREL') ||
    combined.includes('FASHION') ||
    combined.includes('TEXTILE') ||
    combined.includes('GARMENT') ||
    combined.includes('FOOTWEAR')
  ) {
    return 'Retail'
  }

  if (
    combined.includes('MEDIA') ||
    combined.includes('NEWS') ||
    combined.includes('BROADCAST')
  ) {
    return 'Media'
  }

  return 'Miscellaneous'
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

async function ensureStockSectorColumn() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS sector VARCHAR(255);'
  )
}

async function populateStockSectors() {
  try {
    console.log('Ensuring Stock.sector exists...')
    await ensureStockSectorColumn()

    const stocks = await prisma.stock.findMany({
      select: { id: true, symbol: true, name: true },
      orderBy: { symbol: 'asc' },
    })

    console.log(`Found ${stocks.length} stocks to process\n`)

    const updates = stocks.map((stock) => {
      const mapped = sectorMapping[stock.symbol]
      return {
        id: stock.id,
        symbol: stock.symbol,
        name: stock.name,
        sector: mapped ?? guessSector(stock.symbol, stock.name),
        guessed: !mapped,
      }
    })

    const batchSize = 200
    let totalUpdated = 0
    let guessedCount = 0

    for (let index = 0; index < updates.length; index += batchSize) {
      const batch = updates.slice(index, index + batchSize)
      const cases = batch
        .map(
          (row) =>
            `WHEN id = '${escapeSql(row.id)}' THEN '${escapeSql(row.sector)}'`
        )
        .join('\n        ')

      const idList = batch.map((row) => `'${escapeSql(row.id)}'`).join(', ')
      const query = `
        UPDATE "Stock"
        SET sector = CASE
          ${cases}
          ELSE sector
        END
        WHERE id IN (${idList})
      `

      const affected = await prisma.$executeRawUnsafe(query)
      totalUpdated += affected
      guessedCount += batch.filter((row) => row.guessed).length

      console.log(
        `Updated batch ${Math.floor(index / batchSize) + 1}: ${affected} rows`
      )
    }

    const stats = await prisma.$queryRaw<Array<{ sector: string | null; count: bigint }>>`
      SELECT sector, COUNT(*)::bigint AS count
      FROM "Stock"
      GROUP BY sector
      ORDER BY count DESC
    `

    console.log(`\n✅ Updated ${totalUpdated} Stock rows`) 
    console.log(`📊 ${guessedCount} sectors were guessed from stock names\n`)
    console.log('Sector distribution:')
    for (const row of stats) {
      console.log(`  ${row.sector ?? 'NULL'}: ${row.count.toString()} rows`)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

populateStockSectors()
