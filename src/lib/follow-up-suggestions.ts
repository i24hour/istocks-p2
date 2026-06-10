/**
 * Generate ChatGPT-style follow-up chip labels after an assistant reply.
 * Server-only; uses DeepSeek with Bedrock fallback (same pattern as intent-classifier).
 */
import { generateText } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { deepseek, DEEPSEEK_MODEL } from '@/lib/deepseek-provider'
import { getDateContext } from '@/lib/date-context'

const _bedrock = createAmazonBedrock({ region: process.env.AWS_REGION || 'ap-south-1' })
const BEDROCK_FALLBACK = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

export async function generateFollowUpSuggestions(
  userMessage: string,
  assistantMessage: string
): Promise<string[]> {
  const u = userMessage.trim().slice(0, 4000)
  const a = assistantMessage.trim().slice(0, 12000)
  if (!u || !a) return []

  const prompt = `You write short follow-up question chips for an Indian markets / stocks AI assistant (NSE/BSE).

Output ONLY a JSON array of 3 or 4 strings. No markdown, no keys, no explanation.
Each string: one line, max 12 words.

LANGUAGE (mandatory): Look ONLY at the USER'S message below — not the assistant reply.
- If the user wrote in plain/complete English (standard sentences, no Roman Hindi flavor), write EVERY suggestion in natural English only.
- If the user wrote in Hinglish (Roman Hindi mixed with English, e.g. "kya lagta hai", "abhi buy karun", "mujhe batao", "acha hai ya nahi"), write EVERY suggestion in the same Hinglish roman style — same mix and tone as the user. Do not convert Hinglish user prompts to English suggestions.
- Never split languages across suggestions: all items must follow the same rule.

Content: suggestions must logically continue the conversation (deeper dive, related stock, risk, news, comparison, etc.).
Do not repeat the user's last question verbatim. No disclaimers or "consult an advisor".

User asked:
"""
${u}
"""

Assistant replied (for context only; do NOT copy assistant wording for language choice):
"""
${a}
"""

JSON array:`

  const dated = `${getDateContext()}\n${prompt}`

  let text: string
  try {
    const { text: t } = await generateText({
      model: deepseek(DEEPSEEK_MODEL),
      prompt: dated,
      temperature: 0.35,
      maxOutputTokens: 320,
    })
    text = t
  } catch {
    const { text: t } = await generateText({
      model: _bedrock(BEDROCK_FALLBACK),
      prompt: dated,
      temperature: 0.35,
      maxOutputTokens: 320,
    })
    text = t
  }

  const cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .trim()
  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    const arr = JSON.parse(match[0]) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is string => typeof x === 'string')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 4)
  } catch {
    return []
  }
}
