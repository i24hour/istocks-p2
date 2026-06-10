/**
 * Chanakya — Current Intelligence Agent
 *
 * Searches recent news (last 7 and 30 days), scores by recency + relevance,
 * extracts current sentiment signals and derives probability from live intelligence.
 */

import { searchGoogle } from '@/lib/googleSearch'
import { scoreArticlesBatch, computeWeightedProbability } from './article-scorer'
import { generateExpertText } from './expert-llm'
import type { AgentReport, OnExpertsEvent, ScoredArticle } from './types'

interface SearchLayer {
    label: string
    query: string
    recencyDays: number
}

async function buildCurrentSearches(query: string): Promise<SearchLayer[]> {
    const prompt = `You are Chanakya, a current intelligence analyst. Given a probability question, generate 3 search queries targeting RECENT news and developments.

QUESTION: "${query}"

Respond ONLY with a JSON array of 3 objects (no markdown):
[
  { "label": "Latest developments (7 days)", "query": "<search for most recent news>", "recencyDays": 7 },
  { "label": "Recent analysis (30 days)", "query": "<search for recent expert analysis and opinions>", "recencyDays": 30 },
  { "label": "Current situation assessment", "query": "<search for current state of affairs related to question>", "recencyDays": 60 }
]

Rules:
- Focus on CURRENT news, recent events, latest updates
- Include terms like "latest", "current", "recent", "2024", "2025"
- For stocks: include terms like "today", "this week", "outlook"
- Queries should reveal current momentum and direction`

    try {
        const text = await generateExpertText('chanakya', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        if (Array.isArray(parsed) && parsed.length >= 3) {
            return parsed.slice(0, 3).map((l: any) => ({
                label: String(l.label || 'Current news'),
                query: String(l.query || query),
                recencyDays: Number(l.recencyDays) || 30,
            }))
        }
    } catch { /* fall through */ }

    return [
        { label: 'Latest developments (7 days)', query: `${query} latest news 2025`, recencyDays: 7 },
        { label: 'Recent analysis (30 days)', query: `${query} recent analysis outlook`, recencyDays: 30 },
        { label: 'Current situation', query: `${query} current situation today`, recencyDays: 60 },
    ]
}

function applyRecencyBonus(articles: ScoredArticle[]): ScoredArticle[] {
    const now = Date.now()
    return articles.map(a => {
        if (!a.datePublished) return a
        try {
            const published = new Date(a.datePublished).getTime()
            const daysOld = (now - published) / (1000 * 60 * 60 * 24)
            // Articles < 7 days get 1.3× confidence, < 30 days get 1.1×
            const recencyMultiplier = daysOld < 7 ? 1.3 : daysOld < 30 ? 1.1 : 1.0
            return { ...a, confidence: Math.min(1, a.confidence * recencyMultiplier) }
        } catch {
            return a
        }
    })
}

async function synthesizeReport(query: string, articles: ScoredArticle[], rawProbability: number): Promise<{ keyReasons: string[]; reasoning: string }> {
    const topArticles = articles.slice(0, 8).map(a =>
        `- [${a.datePublished || 'recent'}, ${Math.round(a.relevance * 100)}% relevant, signal ${a.probabilitySignal > 0 ? '+' : ''}${a.probabilitySignal.toFixed(2)}] ${a.keyStatement}`
    ).join('\n')

    const prompt = `You are Chanakya, a current intelligence analyst. Synthesize recent news and developments to estimate probability.

QUESTION: "${query}"

RECENT INTELLIGENCE:
${topArticles}

WEIGHTED PROBABILITY FROM CURRENT NEWS: ${rawProbability}%

Provide a synthesis as JSON (no markdown):
{
  "keyReasons": ["<reason 1>", "<reason 2>", "<reason 3>", "<reason 4>"],
  "reasoning": "<2-3 sentence paragraph explaining what current intelligence tells us and why you arrive at this probability>"
}

Focus on current trends, recent signals, breaking developments. What does the current intelligence say?`

    try {
        const text = await generateExpertText('chanakya', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        return {
            keyReasons: Array.isArray(parsed.keyReasons) ? parsed.keyReasons.slice(0, 4) : [],
            reasoning: String(parsed.reasoning || ''),
        }
    } catch {
        return {
            keyReasons: ['Limited recent data available'],
            reasoning: `Based on current news analysis, the probability estimate is ${rawProbability}%.`,
        }
    }
}

export async function runChanakya(
    query: string,
    emit: OnExpertsEvent
): Promise<AgentReport> {
    emit({ type: 'agent_start', agent: 'chanakya' })

    const layers = await buildCurrentSearches(query)
    const allArticles: ScoredArticle[] = []
    const searchQueries: string[] = []

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        emit({
            type: 'agent_searching',
            agent: 'chanakya',
            searchQuery: layer.query,
            layer: i + 1,
            layerLabel: layer.label,
        })

        const result = await searchGoogle(
            layer.query,
            '',
            undefined,
            10,
            { recencyDays: layer.recencyDays, sortByDate: true }
        )
        searchQueries.push(layer.query)

        if (result.success && result.results.length > 0) {
            const raw = result.results.map(r => ({ title: r.name, url: r.url, snippet: r.snippet, datePublished: r.datePublished }))
            const scored = await scoreArticlesBatch(query, raw, 'chanakya')
            const withBonus = applyRecencyBonus(scored)
            for (const article of withBonus) {
                if (!allArticles.find(a => a.url === article.url)) {
                    allArticles.push(article)
                    emit({ type: 'agent_article', agent: 'chanakya', article })
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
        agent: 'chanakya',
        probability: rawProbability,
        confidence: Math.round(overallConfidence * 100) / 100,
        keyReasons,
        articles: sorted,
        searchQueries,
        reasoning,
    }

    emit({ type: 'agent_conclusion', agent: 'chanakya', report })
    return report
}
