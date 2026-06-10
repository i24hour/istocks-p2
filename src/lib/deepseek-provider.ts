import { createOpenAI } from '@ai-sdk/openai'

/**
 * DeepSeek-V4-Flash via Azure AI Foundry (OpenAI-compatible endpoint).
 * Override via DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY / DEEPSEEK_MODEL env vars.
 */
export const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://codex85953.services.ai.azure.com/models',
})

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'DeepSeek-V4-Flash'
