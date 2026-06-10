/**
 * Client-safe list of Compute models shown in the Trading Agent chat selector.
 * IMPORTANT: only Compute labels live here — the underlying provider/model names
 * (Gemini, GPT, etc.) stay on the server in `src/lib/compute-models.ts`.
 */

export type ComputeModelId = 'compute-1.0' | 'compute-0.5'

export interface ComputeModelOption {
    id: ComputeModelId
    label: string
    description?: string
    deprecated?: boolean
}

export const COMPUTE_MODEL_OPTIONS: ReadonlyArray<ComputeModelOption> = [
    { id: 'compute-1.0', label: 'Compute 1.0', description: 'Current' },
    { id: 'compute-0.5', label: 'Compute 0.5', deprecated: true },
]

export const DEFAULT_COMPUTE_MODEL: ComputeModelId = 'compute-1.0'

export function isComputeModelId(value: unknown): value is ComputeModelId {
    return value === 'compute-1.0' || value === 'compute-0.5'
}
