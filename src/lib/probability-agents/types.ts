export type AgentName = 'krishna' | 'chanakya' | 'aryabhata'

export interface ScoredArticle {
    title: string
    url: string
    snippet: string
    datePublished?: string
    relevance: number        // 0-1: how directly relevant to the query
    probabilitySignal: number // -1 to +1: -1 = very unlikely, +1 = very likely
    confidence: number       // 0-1: how trustworthy this source/data is
    keyStatement: string     // most important extracted statement
}

export interface SqlDataPoint {
    description: string      // what was queried
    query: string
    result: string           // formatted result
    probabilitySignal: number // -1 to +1
    confidence: number
}

export interface AgentReport {
    agent: AgentName
    probability: number      // 0-100 final probability estimate
    confidence: number       // 0-1 overall confidence in the estimate
    keyReasons: string[]     // top 3-5 reasons supporting this probability
    articles: ScoredArticle[]
    sqlDataPoints?: SqlDataPoint[]
    searchQueries: string[]  // what was searched
    reasoning: string        // full agent reasoning paragraph
}

export interface DiscussionTurn {
    round: number
    agent: AgentName
    text: string
    probabilityAdjustment?: number // optional adjustment after seeing others
}

export interface FinalProbabilityResult {
    probability: number          // 0-100
    confidence: 'low' | 'medium' | 'high'
    agentWeights: Record<AgentName, number>
    weightedBreakdown: Record<AgentName, { probability: number; weight: number }>
    discussionLog: DiscussionTurn[]
    reasoning: string            // why the agents converged on this
    consensusPoints: string[]    // what all agents agreed on
    conflictPoints: string[]     // where agents disagreed and how resolved
}

export type ExpertsEvent =
    | { type: 'session_created'; sessionId: string }
    | { type: 'query_parsed'; query: string; isStockRelated: boolean; symbol?: string; stockName?: string }
    | { type: 'agent_start'; agent: AgentName }
    | { type: 'agent_searching'; agent: AgentName; searchQuery: string; layer: number; layerLabel: string }
    | { type: 'agent_article'; agent: AgentName; article: ScoredArticle }
    | { type: 'agent_sql'; agent: 'aryabhata'; dataPoint: SqlDataPoint }
    | { type: 'agent_conclusion'; agent: AgentName; report: AgentReport }
    | { type: 'discussion_start'; round: number; totalRounds: number }
    | { type: 'discussion_point'; round: number; agent: AgentName; text: string }
    | { type: 'final_probability'; result: FinalProbabilityResult }
    | { type: 'analysis_saved'; analysisId: string }
    | { type: 'error'; message: string }

export type OnExpertsEvent = (event: ExpertsEvent) => void
