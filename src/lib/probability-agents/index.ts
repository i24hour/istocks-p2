/**
 * Probability Agents Orchestrator
 *
 * Runs Krishna, Chanakya, and Aryabhata in parallel,
 * then feeds all three reports into the Synthesizer for discussion + final probability.
 */

import { prisma } from '@/lib/prisma'
import { runKrishna } from './krishna'
import { runChanakya } from './chanakya'
import { runAryabhata } from './aryabhata'
import { runSynthesizer } from './synthesizer'
import type { AgentName, AgentReport, FinalProbabilityResult, OnExpertsEvent } from './types'

interface RunExpertsOptions {
    sessionId: string
    userId?: string
    userProvidedData?: string
    discussionRounds?: number
}

export async function runExperts(
    query: string,
    emit: OnExpertsEvent,
    options: RunExpertsOptions
): Promise<FinalProbabilityResult> {
    const { sessionId, userProvidedData, discussionRounds = 2 } = options

    // Run all three agents in parallel
    const [krishnaReport, chanakyaReport, aryabhataReport] = await Promise.all([
        runKrishna(query, emit),
        runChanakya(query, emit),
        runAryabhata(query, emit, userProvidedData),
    ])

    const reports: Record<AgentName, AgentReport> = {
        krishna: krishnaReport,
        chanakya: chanakyaReport,
        aryabhata: aryabhataReport,
    }

    // Run discussion + synthesize final probability
    const result = await runSynthesizer(query, reports, emit, discussionRounds)

    // Persist to database
    try {
        const analysis = await prisma.expertsAnalysis.create({
            data: {
                sessionId,
                query,
                krishnaReport: krishnaReport as any,
                chanakyaReport: chanakyaReport as any,
                aryabhataReport: aryabhataReport as any,
                discussionLog: result.discussionLog as any,
                finalProbability: result.probability,
                finalConfidence: result.confidence,
                finalReasoning: result.reasoning,
            },
        })
        emit({ type: 'analysis_saved', analysisId: analysis.id })
    } catch (err) {
        console.error('[Experts] Failed to save analysis:', err)
    }

    return result
}

export async function createExpertsSession(
    query: string,
    userId?: string
): Promise<string> {
    const title = query.length > 80 ? query.slice(0, 77) + '...' : query
    const session = await prisma.expertsSession.create({
        data: { query, title, userId },
    })
    return session.id
}
