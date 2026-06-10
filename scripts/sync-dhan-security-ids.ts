import { prisma } from '../src/lib/prisma'

const DHAN_SCRIP_MASTER_URL =
  process.env.DHAN_SCRIP_MASTER_URL || 'https://images.dhan.co/api-data/api-scrip-master.csv'

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += ch
  }

  cells.push(current)
  return cells
}

function pickFirst(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value && value.trim()) return value.trim()
  }
  return null
}

function normalizeSymbol(raw: string): string {
  return raw
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/-EQ$/i, '')
    .replace(/\.NS$/i, '')
}

async function main() {
  console.log(`Fetching Dhan scrip master: ${DHAN_SCRIP_MASTER_URL}`)
  const response = await fetch(DHAN_SCRIP_MASTER_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch Dhan scrip master (${response.status})`)
  }

  const csvText = await response.text()
  const lines = csvText.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('Dhan CSV appears empty')
  }

  const headers = parseCsvLine(lines[0]).map(h => h.trim())
  const rows = lines.slice(1)

  const symbolToSecurityId = new Map<string, string>()

  for (const line of rows) {
    const cells = parseCsvLine(line)
    if (cells.length !== headers.length) continue

    const row: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i]
    }

    const exchange = pickFirst(row, [
      'SEM_EXM_EXCH_ID',
      'EXCHANGE',
      'EXCH',
    ])

    if (exchange && !/(NSE|BSE)/i.test(exchange)) {
      continue
    }

    const securityId = pickFirst(row, [
      'SEM_SMST_SECURITY_ID',
      'SECURITY_ID',
      'securityId',
    ])

    const symbol = pickFirst(row, [
      'SEM_CUSTOM_SYMBOL',
      'SEM_TRADING_SYMBOL',
      'SM_SYMBOL_NAME',
      'SEM_SYMBOL_NAME',
      'TRADING_SYMBOL',
      'SYMBOL',
    ])

    if (!securityId || !symbol) continue

    const normalized = normalizeSymbol(symbol)
    if (!normalized) continue

    if (!symbolToSecurityId.has(normalized)) {
      symbolToSecurityId.set(normalized, securityId)
    }
  }

  const stocks = await prisma.stock.findMany({
    select: { id: true, symbol: true, exchange: true, dhanSecurityId: true },
  })

  let updated = 0
  for (const stock of stocks) {
    const normalized = normalizeSymbol(stock.symbol)
    const securityId = symbolToSecurityId.get(normalized)
    if (!securityId) continue
    if (stock.dhanSecurityId === securityId) continue

    await prisma.stock.update({
      where: { id: stock.id },
      data: { dhanSecurityId: securityId },
    })
    updated += 1
  }

  console.log(`Stocks scanned: ${stocks.length}`)
  console.log(`Security IDs mapped/updated: ${updated}`)
}

main()
  .catch((error) => {
    console.error('sync-dhan-security-ids failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
