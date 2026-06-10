import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'

const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION || 'ap-south-1',
})

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

export type AIProvider = 'bedrock' | 'claude' | 'gpt'

export const AI_PROVIDERS = {
    bedrock: {
        name: 'Claude Sonnet 4.6 (Bedrock)',
        model: () => bedrock(BEDROCK_MODEL),
        available: () => !!process.env.AWS_BEARER_TOKEN_BEDROCK || !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    },
    claude: {
        name: 'Claude 3.5',
        model: () => anthropic('claude-3-5-sonnet-20241022'),
        available: () => !!process.env.ANTHROPIC_API_KEY,
    },
    gpt: {
        name: 'GPT-4o',
        model: () => openai('gpt-4o'),
        available: () => !!process.env.OPENAI_API_KEY,
    },
} as const

export function getModel(provider: AIProvider) {
    const config = AI_PROVIDERS[provider]
    if (!config) {
        throw new Error(`Unknown provider: ${provider}`)
    }
    if (!config.available()) {
        throw new Error(`API key not configured for ${config.name}`)
    }
    return config.model()
}

export function getAvailableProviders(): { id: AIProvider; name: string }[] {
    return Object.entries(AI_PROVIDERS)
        .filter(([_, config]) => config.available())
        .map(([id, config]) => ({ id: id as AIProvider, name: config.name }))
}
