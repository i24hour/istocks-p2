/**
 * Krishna — Historical Correlation Agent
 *
 * Searches past events layered from general → specific,
 * correlates them with the query, and derives a probability from historical precedent.
 */

import { searchGoogle } from '@/lib/googleSearch'
import { scoreArticlesBatch, computeWeightedProbability } from './article-scorer'
import { generateExpertText } from './expert-llm'
import type { AgentReport, OnExpertsEvent, ScoredArticle } from './types'

interface SearchLayer {
    label: string
    query: string
    recencyDays?: number
}

async function buildSearchLayers(query: string): Promise<SearchLayer[]> {
    const prompt = `You are Krishna, a historical correlation analyst. Given a probability question, generate 3 layered search queries from GENERAL to SPECIFIC historical precedents.

QUESTION: "${query}"

Respond ONLY with a JSON array of 3 objects (no markdown):
[
  { "label": "General historical precedent", "query": "<broad historical search query>", "recencyDays": null },
  { "label": "Similar past events", "query": "<narrower search with relevant context>", "recencyDays": null },
  { "label": "Closest historical match", "query": "<most specific historical analog>", "recencyDays": null }
]

Rules:
- Each query should be progressively more specific to the question
- Focus on PAST events and historical data, not current news
- Queries should help find base rates and historical outcomes
- For stocks: include Indian market context if relevant`

    try {
        const text = await generateExpertText('krishna', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        if (Array.isArray(parsed) && parsed.length >= 3) {
            return parsed.slice(0, 3).map((l: any) => ({
                label: String(l.label || 'Historical search'),
                query: String(l.query || query),
                recencyDays: l.recencyDays ? Number(l.recencyDays) : undefined,
            }))
        }
    } catch { /* fall through */ }

    return [
        { label: 'General historical precedent', query: `${query} historical precedent examples` },
        { label: 'Similar past events', query: `${query} past cases outcomes statistics` },
        { label: 'Closest historical match', query: `${query} historical data analysis probability` },
    ]
}

async function synthesizeReport(query: string, articles: ScoredArticle[], rawProbability: number): Promise<{ keyReasons: string[]; reasoning: string }> {
    const topArticles = articles.slice(0, 8).map(a =>
        `- [${Math.round(a.relevance * 100)}% relevant, signal ${a.probabilitySignal > 0 ? '+' : ''}${a.probabilitySignal.toFixed(2)}] ${a.keyStatement}`
    ).join('\n')

    const prompt = `You are Krishna, a historical correlation analyst. Synthesize historical evidence to estimate probability.

QUESTION: "${query}"

TOP HISTORICAL EVIDENCE:
${topArticles}

WEIGHTED PROBABILITY FROM EVIDENCE: ${rawProbability}%

Provide a synthesis as JSON (no markdown):
{
  "keyReasons": ["<reason 1>", "<reason 2>", "<reason 3>", "<reason 4>"],
  "reasoning": "<2-3 sentence paragraph explaining the historical correlation and why you arrive at this probability>"
}

Focus on historical base rates, precedents, and patterns. Be specific about what history says.`

    try {
        const text = await generateExpertText('krishna', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        return {
            keyReasons: Array.isArray(parsed.keyReasons) ? parsed.keyReasons.slice(0, 4) : [],
            reasoning: String(parsed.reasoning || ''),
        }
    } catch {
        return {
            keyReasons: ['Insufficient historical data to draw strong conclusions'],
            reasoning: `Based on historical precedents found, the probability estimate is ${rawProbability}%.`,
        }
    }
}

export async function runKrishna(
    query: string,
    emit: OnExpertsEvent
): Promise<AgentReport> {
    emit({ type: 'agent_start', agent: 'krishna' })

    const layers = await buildSearchLayers(query)
    const allArticles: ScoredArticle[] = []
    const searchQueries: string[] = []

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        emit({
            type: 'agent_searching',
            agent: 'krishna',
            searchQuery: layer.query,
            layer: i + 1,
            layerLabel: layer.label,
        })

        const result = await searchGoogle(
            layer.query,
            '',
            undefined,
            10,
            layer.recencyDays ? { recencyDays: layer.recencyDays } : {}
        )
        searchQueries.push(layer.query)

        if (result.success && result.results.length > 0) {
            const raw = result.results.map(r => ({ title: r.name, url: r.url, snippet: r.snippet, datePublished: r.datePublished }))
            const scored = await scoreArticlesBatch(query, raw, 'krishna')
            for (const article of scored) {
                if (!allArticles.find(a => a.url === article.url)) {
                    allArticles.push(article)
                    emit({ type: 'agent_article', agent: 'krishna', article })
                }
            }
        }
    }

    const sorted = allArticles.sort((a, b) => (b.relevance * b.confidence) - (a.relevance * a.confidence))
    const rawProbability = computeWeightedProbability(sorted)
    const overallConfidence = sorted.length > 0
        ? sorted.slice(0, 10).reduce((s, a) => s + a.confidence, 0) / Math.min(10, sorted.length)
        : 0.3

    const { keyReasons, reasoning } = await synthesizeReport(query, sorted, rawProbability)

    const report: AgentReport = {
        agent: 'krishna',
        probability: rawProbability,
        confidence: Math.round(overallConfidence * 100) / 100,
        keyReasons,
        articles: sorted,
        searchQueries,
        reasoning,
    }

    emit({ type: 'agent_conclusion', agent: 'krishna', report })
    return report
}
