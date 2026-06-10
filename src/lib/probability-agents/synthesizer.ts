/**
 * Synthesizer — Discussion Engine + Final Probability Calculator
 *
 * Runs 2-3 rounds of discussion between the three agents,
 * resolves disagreements, and computes a weighted final probability.
 */

import { generateExpertText } from './expert-llm'
import type {
    AgentName,
    AgentReport,
    DiscussionTurn,
    FinalProbabilityResult,
    OnExpertsEvent,
} from './types'

const AGENT_PERSONAS: Record<AgentName, string> = {
    krishna: 'Krishna (Historical Correlation Analyst)',
    chanakya: 'Chanakya (Current Intelligence Analyst)',
    aryabhata: 'Aryabhata (Numerical Data Analyst)',
}

async function runDiscussionRound(
    query: string,
    round: number,
    speakingAgent: AgentName,
    allReports: Record<AgentName, AgentReport>,
    priorTurns: DiscussionTurn[],
    emit: OnExpertsEvent
): Promise<DiscussionTurn> {
    const myReport = allReports[speakingAgent]
    const others = (Object.keys(allReports) as AgentName[]).filter(a => a !== speakingAgent)

    const othersContext = others.map(a => {
        const r = allReports[a]
        return `${AGENT_PERSONAS[a]}: ${r.probability}% probability — "${r.reasoning}"`
    }).join('\n')

    const priorContext = priorTurns.length > 0
        ? priorTurns.map(t => `Round ${t.round} — ${AGENT_PERSONAS[t.agent]}: "${t.text}"`).join('\n')
        : 'No prior discussion yet.'

    const prompt = `You are ${AGENT_PERSONAS[speakingAgent]} in a panel discussion about the probability of an event.

QUESTION: "${query}"

YOUR ASSESSMENT: ${myReport.probability}% probability
Your reasoning: "${myReport.reasoning}"
Your top reasons: ${myReport.keyReasons.map((r, i) => `${i+1}. ${r}`).join(' | ')}

OTHER ANALYSTS' VIEWS:
${othersContext}

PRIOR DISCUSSION:
${priorContext}

ROUND ${round} — Your turn to respond.

Instructions:
- Respond in 2-3 sentences as ${AGENT_PERSONAS[speakingAgent]}
- Engage with the other analysts' points: agree, disagree, or refine
- Reference your specific evidence (historical data, current news, or numbers)
- If you're adjusting your probability estimate after hearing others, say so explicitly
- Be direct and analytical, not diplomatic fluff

Respond ONLY with a JSON object (no markdown):
{
  "text": "<your 2-3 sentence discussion contribution>",
  "probabilityAdjustment": <optional: new probability if you're updating, else null>
}`

    try {
        const text = await generateExpertText(speakingAgent, prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)

        const turn: DiscussionTurn = {
            round,
            agent: speakingAgent,
            text: String(parsed.text || ''),
            probabilityAdjustment: parsed.probabilityAdjustment != null
                ? Math.max(0, Math.min(100, Number(parsed.probabilityAdjustment)))
                : undefined,
        }

        emit({ type: 'discussion_point', round, agent: speakingAgent, text: turn.text })
        return turn
    } catch {
        const fallback: DiscussionTurn = {
            round,
            agent: speakingAgent,
            text: `Based on my ${speakingAgent === 'krishna' ? 'historical' : speakingAgent === 'chanakya' ? 'current intelligence' : 'numerical'} analysis, I maintain my estimate of ${myReport.probability}%.`,
        }
        emit({ type: 'discussion_point', round, agent: speakingAgent, text: fallback.text })
        return fallback
    }
}

async function computeFinalProbability(
    query: string,
    reports: Record<AgentName, AgentReport>,
    discussionLog: DiscussionTurn[]
): Promise<{ probability: number; reasoning: string; consensusPoints: string[]; conflictPoints: string[] }> {
    // Get final probability positions (accounting for any adjustments in discussion)
    const finalPositions: Record<AgentName, number> = {
        krishna: reports.krishna.probability,
        chanakya: reports.chanakya.probability,
        aryabhata: reports.aryabhata.probability,
    }

    // Apply discussion adjustments
    for (const turn of discussionLog) {
        if (turn.probabilityAdjustment != null) {
            finalPositions[turn.agent] = turn.probabilityAdjustment
        }
    }

    // Weights based on confidence
    const weights: Record<AgentName, number> = {
        krishna: reports.krishna.confidence * 0.30,
        chanakya: reports.chanakya.confidence * 0.35,
        aryabhata: reports.aryabhata.confidence * 0.35,
    }
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
    const normalizedWeights: Record<AgentName, number> = {
        krishna: weights.krishna / totalWeight,
        chanakya: weights.chanakya / totalWeight,
        aryabhata: weights.aryabhata / totalWeight,
    }

    const weightedProbability = Math.round(
        finalPositions.krishna * normalizedWeights.krishna +
        finalPositions.chanakya * normalizedWeights.chanakya +
        finalPositions.aryabhata * normalizedWeights.aryabhata
    )

    // Meta-LLM synthesis
    const prompt = `You are the moderator of a probability analysis panel. Three expert analysts have concluded their discussion.

QUESTION: "${query}"

FINAL POSITIONS:
- Krishna (Historical): ${finalPositions.krishna}% (weight: ${Math.round(normalizedWeights.krishna * 100)}%)
- Chanakya (Current News): ${finalPositions.chanakya}% (weight: ${Math.round(normalizedWeights.chanakya * 100)}%)
- Aryabhata (Numerical): ${finalPositions.aryabhata}% (weight: ${Math.round(normalizedWeights.aryabhata * 100)}%)

WEIGHTED FINAL: ${weightedProbability}%

KEY DISCUSSION POINTS:
${discussionLog.slice(-6).map(t => `- ${AGENT_PERSONAS[t.agent]}: "${t.text}"`).join('\n')}

Provide final synthesis as JSON (no markdown):
{
  "reasoning": "<2-3 sentence explanation of why the panel converged on this probability, citing specific evidence from all three analysts>",
  "consensusPoints": ["<point all agreed on>", "<another consensus point>"],
  "conflictPoints": ["<main disagreement and how it was resolved>"]
}`

    try {
        const text = await generateExpertText('synthesizer', prompt)
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        return {
            probability: weightedProbability,
            reasoning: String(parsed.reasoning || ''),
            consensusPoints: Array.isArray(parsed.consensusPoints) ? parsed.consensusPoints : [],
            conflictPoints: Array.isArray(parsed.conflictPoints) ? parsed.conflictPoints : [],
        }
    } catch {
        return {
            probability: weightedProbability,
            reasoning: `The panel weighted three perspectives to arrive at a final probability of ${weightedProbability}%.`,
            consensusPoints: [],
            conflictPoints: [],
        }
    }
}

function getConfidenceLabel(avgConfidence: number): 'low' | 'medium' | 'high' {
    if (avgConfidence >= 0.7) return 'high'
    if (avgConfidence >= 0.45) return 'medium'
    return 'low'
}

export async function runSynthesizer(
    query: string,
    reports: Record<AgentName, AgentReport>,
    emit: OnExpertsEvent,
    rounds = 2
): Promise<FinalProbabilityResult> {
    const discussionLog: DiscussionTurn[] = []
    const agents: AgentName[] = ['krishna', 'chanakya', 'aryabhata']

    for (let round = 1; round <= rounds; round++) {
        emit({ type: 'discussion_start', round, totalRounds: rounds })

        for (const agent of agents) {
            const turn = await runDiscussionRound(query, round, agent, reports, discussionLog, emit)
            discussionLog.push(turn)
        }
    }

    const { probability, reasoning, consensusPoints, conflictPoints } = await computeFinalProbability(
        query,
        reports,
        discussionLog
    )

    const avgConfidence = (reports.krishna.confidence + reports.chanakya.confidence + reports.aryabhata.confidence) / 3

    const weights: Record<AgentName, number> = {
        krishna: Math.round(reports.krishna.confidence * 0.30 * 100) / 100,
        chanakya: Math.round(reports.chanakya.confidence * 0.35 * 100) / 100,
        aryabhata: Math.round(reports.aryabhata.confidence * 0.35 * 100) / 100,
    }

    const result: FinalProbabilityResult = {
        probability,
        confidence: getConfidenceLabel(avgConfidence),
        agentWeights: weights,
        weightedBreakdown: {
            krishna: { probability: reports.krishna.probability, weight: weights.krishna },
            chanakya: { probability: reports.chanakya.probability, weight: weights.chanakya },
            aryabhata: { probability: reports.aryabhata.probability, weight: weights.aryabhata },
        },
        discussionLog,
        reasoning,
        consensusPoints,
        conflictPoints,
    }

    emit({ type: 'final_probability', result })
    return result
}
