import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { getDateContext } from '@/lib/date-context'
import type { AgentName } from './types'

type ExpertRuntime = AgentName | 'synthesizer'
type ExpertProvider = 'azure' | 'bedrock' | 'qwen' | 'openai-compatible'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

const DEFAULT_PROVIDERS: Record<ExpertRuntime, ExpertProvider> = {
    krishna: 'azure',
    chanakya: 'bedrock',
    aryabhata: 'qwen',
    synthesizer: 'azure',
}

const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

function runtimeEnvPrefix(runtime: ExpertRuntime): string {
    return `EXPERT_${runtime.toUpperCase()}`
}

function readEnv(...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim()
        if (value) return value
    }
    return undefined
}

function normalizeProvider(value: string | undefined, fallback: ExpertProvider): ExpertProvider {
    const normalized = value?.toLowerCase().trim()
    if (normalized === 'azure' || normalized === 'bedrock' || normalized === 'qwen' || normalized === 'openai-compatible') {
        return normalized
    }
    return fallback
}

function normalizeAzureEndpoint(endpoint: string): string {
    return endpoint
        .replace(/\/+$/, '')
        .replace(/\/openai\/deployments\/[^/]+$/i, '')
        .replace(/\/openai\/v1$/i, '')
        .replace(/\/openai$/i, '')
}

async function generateWithBedrock(runtime: ExpertRuntime, prompt: string, temperature: number): Promise<string> {
    const modelId = readEnv(`${runtimeEnvPrefix(runtime)}_MODEL`, 'BEDROCK_MODEL_ID') || BEDROCK_MODEL
    const bedrock = createAmazonBedrock({
        region: process.env.AWS_REGION || 'ap-south-1',
    })
    const { text } = await generateText({
        model: bedrock(modelId),
        prompt,
        temperature,
    })
    return text
}

async function generateWithAzure(runtime: ExpertRuntime, prompt: string, temperature: number): Promise<string> {
    const prefix = runtimeEnvPrefix(runtime)
    const apiKey = readEnv(`${prefix}_AZURE_API_KEY`, 'AZURE_OPENAI_API_KEY')
    const endpoint = readEnv(`${prefix}_AZURE_ENDPOINT`, 'AZURE_OPENAI_ENDPOINT')
    const deployment = readEnv(`${prefix}_AZURE_DEPLOYMENT`, `${prefix}_MODEL`, 'AZURE_OPENAI_DEPLOYMENT_NAME')
    const apiVersion = readEnv(`${prefix}_AZURE_API_VERSION`, 'AZURE_OPENAI_API_VERSION') || '2025-01-01-preview'

    if (!apiKey || !endpoint || !deployment) {
        throw new Error(`Missing Azure OpenAI config for ${runtime}`)
    }

    const baseEndpoint = normalizeAzureEndpoint(endpoint)
    const url = `${baseEndpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
        },
        body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: 1600,
        }),
    })

    if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Azure OpenAI failed (${response.status}): ${errorText.slice(0, 240)}`)
    }

    const data = await response.json()
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Azure OpenAI returned empty text')
    }
    return text
}

async function generateWithOpenAICompatible(runtime: ExpertRuntime, prompt: string, temperature: number): Promise<string> {
    const prefix = runtimeEnvPrefix(runtime)
    const apiKey = readEnv(`${prefix}_API_KEY`, 'QWEN_API_KEY')
    const baseURL = readEnv(`${prefix}_BASE_URL`, 'QWEN_BASE_URL') || DEFAULT_QWEN_BASE_URL
    const model = readEnv(`${prefix}_MODEL`, 'QWEN_MODEL') || 'qwen-plus'

    if (!apiKey || !baseURL || !model) {
        throw new Error(`Missing OpenAI-compatible config for ${runtime}`)
    }

    const openai = createOpenAI({
        apiKey,
        baseURL,
        name: runtime,
    })
    const { text } = await generateText({
        model: openai.chat(model),
        prompt,
        temperature,
    })
    return text
}

export async function generateExpertText(
    runtime: ExpertRuntime,
    prompt: string,
    options: { temperature?: number } = {}
): Promise<string> {
    const provider = normalizeProvider(
        readEnv(`${runtimeEnvPrefix(runtime)}_PROVIDER`),
        DEFAULT_PROVIDERS[runtime]
    )
    const temperature = options.temperature ?? 0.2
    const datedPrompt = `${getDateContext()}\n${prompt}`

    try {
        if (provider === 'azure') return await generateWithAzure(runtime, datedPrompt, temperature)
        if (provider === 'bedrock') return await generateWithBedrock(runtime, datedPrompt, temperature)
        return await generateWithOpenAICompatible(runtime, datedPrompt, temperature)
    } catch (err: any) {
        if (provider !== 'bedrock') {
            console.warn(`[experts:${runtime}] ${provider} failed, falling back to Bedrock:`, err?.message)
            return generateWithBedrock(runtime, datedPrompt, temperature)
        }
        throw err
    }
}
