import { generateExpertText } from './expert-llm'
import type { AgentName, ScoredArticle } from './types'

interface RawArticle {
    title: string
    url: string
    snippet: string
    datePublished?: string
}

export async function scoreArticle(
    query: string,
    article: RawArticle,
    agent: AgentName = 'chanakya'
): Promise<ScoredArticle> {
    const prompt = `You are a probability analyst. Score how an article contributes to answering a probability question.

QUERY: "${query}"

ARTICLE:
Title: ${article.title}
Date: ${article.datePublished || 'unknown'}
Snippet: ${article.snippet}

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "relevance": <0.0-1.0, how directly relevant is this article to the query>,
  "probabilitySignal": <-1.0 to 1.0, negative=decreases probability, positive=increases probability, 0=neutral>,
  "confidence": <0.0-1.0, how trustworthy/specific is this source>,
  "keyStatement": "<most important single statement from this article relevant to the query>"
}

Rules:
- relevance 0.0 = completely unrelated, 1.0 = directly answers the query
- probabilitySignal: -1.0 = near certain NOT to happen, +1.0 = near certain to happen
- confidence: lower for opinion pieces, higher for official data/statistics/official statements
- keyStatement: one sentence maximum, quote the article if possible`

    try {
        const text = await generateExpertText(agent, prompt)

        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)

        return {
            title: article.title,
            url: article.url,
            snippet: article.snippet,
            datePublished: article.datePublished,
            relevance: Math.max(0, Math.min(1, Number(parsed.relevance) || 0)),
            probabilitySignal: Math.max(-1, Math.min(1, Number(parsed.probabilitySignal) || 0)),
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
            keyStatement: String(parsed.keyStatement || article.snippet.slice(0, 150)),
        }
    } catch {
        return {
            title: article.title,
            url: article.url,
            snippet: article.snippet,
            datePublished: article.datePublished,
            relevance: 0.3,
            probabilitySignal: 0,
            confidence: 0.3,
            keyStatement: article.snippet.slice(0, 150),
        }
    }
}

export async function scoreArticlesBatch(
    query: string,
    articles: RawArticle[],
    agent: AgentName = 'chanakya'
): Promise<ScoredArticle[]> {
    const results = await Promise.allSettled(
        articles.map(a => scoreArticle(query, a, agent))
    )
    return results
        .filter((r): r is PromiseFulfilledResult<ScoredArticle> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(a => a.relevance > 0.1) // discard clearly irrelevant
        .sort((a, b) => (b.relevance * b.confidence) - (a.relevance * a.confidence))
}

export function computeWeightedProbability(articles: ScoredArticle[]): number {
    if (articles.length === 0) return 50

    let weightedSum = 0
    let totalWeight = 0

    for (const a of articles) {
        const weight = a.relevance * a.confidence
        if (weight < 0.05) continue
        // Convert signal (-1..+1) to probability contribution (0..100)
        const contribution = (a.probabilitySignal + 1) / 2 * 100
        weightedSum += contribution * weight
        totalWeight += weight
    }

    if (totalWeight === 0) return 50
    return Math.round(weightedSum / totalWeight)
}
