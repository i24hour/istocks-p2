/**
 * Compute Models — iStocks "Compute" model family.
 *
 * This module maps user-visible model IDs (e.g. "compute-1.0") to the
 * underlying AI-SDK providers. The underlying provider / model names
 * are NEVER exposed to the client — the UI and network payloads only
 * reference the Compute label.
 *
 * To add / rename a model, update `COMPUTE_MODELS` below. Deprecated
 * Models stay in the registry with `deprecated: true` so past clients
 * fall back gracefully.
 */
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6'

export type ComputeModelId = 'compute-1.0' | 'compute-0.5' | 'compute-0.2' | 'compute-0.1'

interface ComputeModelDef {
    id: ComputeModelId
    label: string
    deployment: string
    deprecated?: boolean
}

/**
 * Only models in `COMPUTE_MODELS_VISIBLE` (see below) are shown in the UI.
 * Deprecated models stay here so history and old clients still resolve.
 */
export const COMPUTE_MODELS: Readonly<Record<ComputeModelId, ComputeModelDef>> = {
    'compute-1.0': {
        id: 'compute-1.0',
        label: 'Compute 1.0',
        deployment: BEDROCK_MODEL,
    },
    'compute-0.5': {
        id: 'compute-0.5',
        label: 'Compute 0.5',
        deployment: BEDROCK_MODEL,
        deprecated: true,
    },
    'compute-0.2': {
        id: 'compute-0.2',
        label: 'Compute 0.2',
        deployment: BEDROCK_MODEL,
        deprecated: true,
    },
    'compute-0.1': {
        id: 'compute-0.1',
        label: 'Compute 0.1',
        deployment: BEDROCK_MODEL,
        deprecated: true,
    },
}

export const DEFAULT_COMPUTE_MODEL: ComputeModelId = 'compute-1.0'

/**
 * Client-visible list — deprecated models are filtered out.
 * Only label + id are exposed; the backing provider/model never leaves the server.
 */
export const VISIBLE_COMPUTE_MODELS: ReadonlyArray<{ id: ComputeModelId; label: string }> =
    (Object.values(COMPUTE_MODELS) as ComputeModelDef[])
        .filter(m => !m.deprecated)
        .map(m => ({ id: m.id, label: m.label }))

export function isComputeModelId(value: unknown): value is ComputeModelId {
    return typeof value === 'string' && value in COMPUTE_MODELS
}

export function resolveComputeModel(id: unknown): ComputeModelDef {
    if (isComputeModelId(id)) {
        const def = COMPUTE_MODELS[id]
        if (!def.deprecated) return def
    }
    return COMPUTE_MODELS[DEFAULT_COMPUTE_MODEL]
}

// ── Lazy SDK factory ──────────────────────────────────────────────────────

let _bedrockSdk: ReturnType<typeof createAmazonBedrock> | null = null
function getBedrockSdk() {
    if (!_bedrockSdk) {
        _bedrockSdk = createAmazonBedrock({
            region: process.env.AWS_REGION || 'ap-south-1',
        })
    }
    return _bedrockSdk
}

/**
 * Return a Vercel AI SDK `LanguageModel` instance for the given Compute.
 */
export function getComputeAiSdkModel(compute?: ComputeModelId | null | string): LanguageModel {
    const def = resolveComputeModel(compute)
    return getBedrockSdk()(def.deployment)
}

/**
 * Legacy `generateContent` adapter — same call-site shape as the old Google GenerativeAI client.
 */
export interface LegacyGenerativeModel {
    generateContent(prompt: string): Promise<{ response: { text(): string } }>
}

export function getComputeLegacyModel(
    compute: ComputeModelId | null | string | undefined,
    generationConfig?: { temperature?: number }
): LegacyGenerativeModel {
    const def = resolveComputeModel(compute)
    const temperature = generationConfig?.temperature
    const sdkModel: LanguageModel = getBedrockSdk()(def.deployment)

    return {
        async generateContent(prompt: string) {
            const { text } = await generateText({
                model: sdkModel,
                prompt,
                ...(typeof temperature === 'number' ? { temperature } : {}),
            })
            return { response: { text: () => text } }
        },
    }
}

/**
 * Parse an arbitrary value (from a client payload) into a valid, non-deprecated
 * Compute model id. Unknown / deprecated values collapse to the default Compute.
 */
export function coerceComputeModelId(value: unknown): ComputeModelId {
    if (isComputeModelId(value) && !COMPUTE_MODELS[value].deprecated) return value
    return DEFAULT_COMPUTE_MODEL
}
