/**
 * Unified LLM Client
 *
 * Wraps the Vercel AI SDK to support multiple providers:
 *   bedrock (default) — Claude Sonnet 4.6 via Amazon Bedrock
 *   openai            — OpenAI GPT-* models
 *   openrouter        — Any model through openrouter.ai
 *   groq              — Groq fast-inference (Llama, Mixtral …)
 *   anthropic         — Anthropic Claude models
 *   custom            — Any OpenAI-compatible endpoint (Ollama, etc.)
 */

import { generateText } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

const _systemBedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })

async function callSystemBedrock(prompt: string, temperature: number): Promise<string> {
  const { text } = await generateText({
    model: _systemBedrock(BEDROCK_MODEL),
    prompt,
    temperature,
  })
  return text
}

export interface UserLLMConfig {
  provider: string   // "bedrock" | "openai" | "openrouter" | "groq" | "anthropic" | "custom"
  apiKey: string
  model: string
  baseUrl?: string | null
}

/**
 * Known provider presets — baseURL + sample models (shown in the UI).
 * "custom" lets the user enter their own baseURL.
 */
export const LLM_PROVIDERS = [
  {
    id: 'bedrock',
    label: 'Claude Sonnet 4.6 (Bedrock)',
    placeholder: 'AWS bearer token',
    keyLabel: 'AWS Bearer Token',
    keyHint: 'Set AWS_BEARER_TOKEN_BEDROCK environment variable',
    models: ['global.anthropic.claude-sonnet-4-6'],
    defaultModel: 'global.anthropic.claude-sonnet-4-6',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-…',
    keyLabel: 'OpenAI API Key',
    keyHint: 'platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'],
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    placeholder: 'sk-or-v1-…',
    keyLabel: 'OpenRouter API Key',
    keyHint: 'openrouter.ai/keys',
    models: [
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-405b-instruct',
      'mistralai/mistral-large',
      'deepseek/deepseek-r1',
    ],
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
  {
    id: 'groq',
    label: 'Groq',
    placeholder: 'gsk_…',
    keyLabel: 'Groq API Key',
    keyHint: 'console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    placeholder: 'sk-ant-…',
    keyLabel: 'Anthropic API Key',
    keyHint: 'console.anthropic.com/settings/keys',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-3-5-haiku-20241022',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    placeholder: 'your-api-key',
    keyLabel: 'API Key',
    keyHint: 'Any OpenAI-compatible endpoint (Ollama, LM Studio, etc.)',
    models: [],
    defaultModel: '',
  },
] as const

// ── Core generation function ───────────────────────────────────────────────

export async function callLLM(
  prompt: string,
  config: UserLLMConfig | null | undefined,
  temperature = 0.3,
): Promise<string> {
  // No custom config → fall back to system Bedrock
  if (!config?.apiKey || !config?.model || !config?.provider) {
    return callSystemBedrock(prompt, temperature)
  }

  try {
    switch (config.provider) {
      case 'bedrock': {
        const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
        const { text } = await generateText({
          model: bedrock(config.model),
          prompt,
          temperature,
        })
        return text
      }

      case 'openai': {
        const openai = createOpenAI({ apiKey: config.apiKey })
        const { text } = await generateText({
          model: openai(config.model),
          prompt,
          temperature,
        })
        return text
      }

      case 'openrouter': {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        })
        const { text } = await generateText({
          model: openai(config.model),
          prompt,
          temperature,
        })
        return text
      }

      case 'groq': {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: 'https://api.groq.com/openai/v1',
        })
        const { text } = await generateText({
          model: openai(config.model),
          prompt,
          temperature,
        })
        return text
      }

      case 'anthropic': {
        const anthropic = createAnthropic({ apiKey: config.apiKey })
        const { text } = await generateText({
          model: anthropic(config.model),
          prompt,
          temperature,
        })
        return text
      }

      case 'custom': {
        if (!config.baseUrl) throw new Error('Custom provider requires a Base URL')
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
        })
        const { text } = await generateText({
          model: openai(config.model),
          prompt,
          temperature,
        })
        return text
      }

      default:
        throw new Error(`Unsupported LLM provider: "${config.provider}"`)
    }
  } catch (err: any) {
    console.warn(`[llm-client] Custom LLM call failed (${config.provider}/${config.model}):`, err?.message)
    return callSystemBedrock(prompt, temperature)
  }
}

export function extractUserConfig(user: {
  llmProvider?: string | null
  llmApiKey?: string | null
  llmModel?: string | null
  llmBaseUrl?: string | null
}): UserLLMConfig | null {
  if (!user.llmProvider || !user.llmApiKey || !user.llmModel) return null
  return {
    provider: user.llmProvider,
    apiKey: user.llmApiKey,
    model: user.llmModel,
    baseUrl: user.llmBaseUrl,
  }
}
