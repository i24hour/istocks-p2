import { getInstrumentStore, normalizeSymbolKey } from '@/lib/instrumentRegistry'

export type ResolvedStockMatch = {
  symbol: string
  name: string
  exchange: string | null
  score: number
}

const GENERIC_QUERIES = new Set([
  'IT','THIS','THAT','SAME','THEN','NEXT','CONTINUE','SO','TOH','PHIR','DOIT','DO','PROCEED','AHEAD',
  'VALUE','PRICE','CURRENT','READING','STOCK','STOCKS','SHARE','SHARES','TELL','SHOW','ABOUT','ME','THE','A','AN',
  'OF','FOR','RSI','MACD','EMA','SMA','ADX','ATR','VWAP','NEWS','WHY','WHAT','WHEN','WHERE','WHO','WHICH','TODAY','NOW',
  'KI','KA','KE','KO','KAI','VALUEOF',
])

export function normalizeStockQuery(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function compactStockQuery(value: string): string {
  return normalizeStockQuery(value).replace(/[AEIOU]/g, '')
}

function tokenizeStockQuery(value: string): string[] {
  return (value.toUpperCase().match(/[A-Z0-9]{2,}/g) || [])
}

function meaningfulTokens(value: string): string[] {
  return tokenizeStockQuery(value)
    .filter((token) => !GENERIC_QUERIES.has(token))
    .filter((token) => !/^\d+[DMWY]?$/.test(token))
}

export function buildStockQueryCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  const directNorm = normalizeStockQuery(trimmed)
  const tokens = meaningfulTokens(trimmed)

  const candidates = new Set<string>()

  if (tokens.length > 0) {
    candidates.add(tokens.join(' '))
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j <= tokens.length; j++) {
        const phrase = tokens.slice(i, j).join(' ')
        if (phrase.length >= 3) candidates.add(phrase)
      }
    }
  }

  if (directNorm && !GENERIC_QUERIES.has(directNorm)) {
    candidates.add(trimmed)
  }

  return [...candidates]
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
}

function scoreMatch(candidate: string, symbol: string, name: string): number {
  const queryNorm = normalizeStockQuery(candidate)
  if (!queryNorm) return 0

  const symbolNorm = normalizeStockQuery(symbol)
  const nameNorm = normalizeStockQuery(name)
  const queryCompact = compactStockQuery(candidate)
  const symbolCompact = compactStockQuery(symbol)
  const nameCompact = compactStockQuery(name)
  const queryTokens = meaningfulTokens(candidate)
  const nameTokens = meaningfulTokens(name)

  let score = 0

  if (symbolNorm === queryNorm) return 100
  if (nameNorm === queryNorm) return 99

  if (queryCompact.length >= 5 && (symbolCompact === queryCompact || nameCompact === queryCompact)) {
    score = Math.max(score, 97)
  }

  if (queryNorm.length >= 3 && symbolNorm.startsWith(queryNorm)) {
    score = Math.max(score, 94)
  }
  if (queryNorm.length >= 3 && nameNorm.startsWith(queryNorm)) {
    score = Math.max(score, 92)
  }
  if (queryNorm.length >= 3 && symbolNorm.includes(queryNorm)) {
    score = Math.max(score, 89)
  }
  if (queryNorm.length >= 3 && nameNorm.includes(queryNorm)) {
    score = Math.max(score, 88)
  }

  if (queryCompact.length >= 5) {
    if (symbolCompact.includes(queryCompact) || queryCompact.includes(symbolCompact)) {
      score = Math.max(score, 86)
    }
    if (nameCompact.includes(queryCompact) || queryCompact.includes(nameCompact)) {
      score = Math.max(score, 85)
    }
  }

  const overlap = nameTokens.filter((token) => queryTokens.includes(token)).length
  if (overlap > 0) {
    score += overlap * 10
  }

  const firstQueryToken = queryTokens[0] || ''
  const firstNameToken = nameTokens[0] || ''
  if (firstQueryToken && firstNameToken && firstNameToken.startsWith(firstQueryToken)) {
    score += 8
    if (firstNameToken === firstQueryToken) {
      score += 8
      score += Math.max(0, 6 - nameTokens.length)
    }
  }

  if (queryTokens.length === 1 && queryTokens[0].length >= 4 && symbolNorm.startsWith(queryTokens[0])) {
    score += 7
  }

  if (queryNorm.length <= 4 && score < 85) {
    return 0
  }

  return score
}

export async function resolveClosestStocks(query: string, limit = 5): Promise<ResolvedStockMatch[]> {
  const candidates = buildStockQueryCandidates(query)
  if (candidates.length === 0) return []

  const store = await getInstrumentStore()

  const bestBySymbol = new Map<string, ResolvedStockMatch>()

  for (const candidate of candidates) {
    const queryNorm = normalizeSymbolKey(candidate)
    const queryCompact = compactStockQuery(candidate)
    const candidateSpecificityBonus =
      Math.min(12, queryNorm.length) + Math.min(6, meaningfulTokens(candidate).length * 3)

    for (const row of store.bySymbol.values()) {
      let score = scoreMatch(candidate, row.symbol, row.name)

      for (const alias of row.aliases) {
        const aliasNorm = normalizeSymbolKey(alias)
        const aliasCompact = compactStockQuery(alias)
        if (!aliasNorm) continue

        if (aliasNorm === queryNorm) {
          score = Math.max(score, 130)
          continue
        }

        if (queryNorm.length >= 3 && aliasNorm.startsWith(queryNorm)) {
          score = Math.max(score, 118)
        }

        if (queryCompact.length >= 4 && aliasCompact === queryCompact) {
          score = Math.max(score, 122)
        }

        if (queryCompact.length >= 4 && aliasCompact.startsWith(queryCompact)) {
          score = Math.max(score, 114)
        }
      }

      if (score <= 0) continue
      score += candidateSpecificityBonus
      const existing = bestBySymbol.get(row.symbol)
      if (!existing || score > existing.score) {
        bestBySymbol.set(row.symbol, {
          symbol: row.symbol,
          name: row.name,
          exchange: row.exchange,
          score,
        })
      }
    }
  }

  return [...bestBySymbol.values()]
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
}
