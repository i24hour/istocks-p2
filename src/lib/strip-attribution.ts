// Removes internal data provider/tool references from AI responses before they reach the frontend.
// The user should see clean, brand-neutral analysis — not implementation details.

// Phrases to remove entirely (with surrounding punctuation/whitespace)
const REMOVE_PHRASES = [
  /\baccording to yahoo finance\b[,.]?\s*/gi,
  /\bvia yahoo finance\b[,.]?\s*/gi,
  /\bfrom yahoo finance\b[,.]?\s*/gi,
  /\b\(yahoo finance\)\s*/gi,
  /\byahoo finance (data|says?|shows?|reports?|indicates?)\b[,:]?\s*/gi,
  /\bsource[d]?:?\s*yahoo( finance)?\b[,.]?\s*/gi,
  /\bdata (from|via|source[d]? from) yahoo( finance)?\b[,:]?\s*/gi,

  /\baccording to serper\b[,.]?\s*/gi,
  /\bvia serper\b[,.]?\s*/gi,
  /\bfrom serper\b[,.]?\s*/gi,
  /\b\(serper\)\s*/gi,
  /\bserper (search|api|data|results?)\b[,:]?\s*/gi,

  /\baccording to firecrawl\b[,.]?\s*/gi,
  /\bvia firecrawl\b[,.]?\s*/gi,
  /\bfrom firecrawl\b[,.]?\s*/gi,
  /\b\(firecrawl\)\s*/gi,
  /\bfirecrawl (data|results?|scrape[d]?)\b[,:]?\s*/gi,

  /\baccording to morningstar\b[,.]?\s*/gi,
  /\bvia morningstar\b[,.]?\s*/gi,
  /\bfrom morningstar\b[,.]?\s*/gi,
  /\b\(morningstar\)\s*/gi,
  /\bmorningstar (data|says?|shows?|reports?|indicates?|source[d]?)\b[,:]?\s*/gi,
  /\bsource[d]?:?\s*morningstar\b[,.]?\s*/gi,

  /\baccording to google( search)?\b[,.]?\s*/gi,
  /\bvia google( search)?\b[,.]?\s*/gi,
  /\bfrom google( search)?\b[,.]?\s*/gi,
  /\b\(google( search)?\)\s*/gi,
  /\bgoogle search (results?|data|api)\b[,:]?\s*/gi,

  /\bamazon bedrock\b[,.]?\s*/gi,
  /\bdeepseek(-v\d[\w-]*)?\b[,.]?\s*/gi,
  /\bpowered by (deepseek|bedrock|anthropic|claude)\b[,.]?\s*/gi,
]

// Word-level replacements: keep the concept, drop the brand
const REPLACE_PAIRS: [RegExp, string][] = [
  [/\bnifty\s+100\s+yahoo\b/gi, 'Nifty 100'],
  [/\bnifty\s+50\s+yahoo\b/gi, 'Nifty 50'],
  [/\byahoo\s+(finance\s+)?data\b/gi, 'market data'],
  [/\byahoo\s+finance\b/gi, 'market data'],
  [/\byahoo\b/gi, 'market data'],
]

export function stripAttribution(text: string): string {
  let result = text

  for (const pattern of REMOVE_PHRASES) {
    result = result.replace(pattern, '')
  }

  for (const [pattern, replacement] of REPLACE_PAIRS) {
    result = result.replace(pattern, replacement)
  }

  // Clean up artifacts: double spaces, leading/trailing whitespace per line
  result = result
    .replace(/  +/g, ' ')
    .replace(/^ /gm, '')
    .replace(/ $/gm, '')

  return result
}
