/**
 * Normalize Indian mobile to 10 digits (no +91 in stored form).
 * Returns null if invalid.
 */
export function normalizeIndianMobile(input: string | undefined | null): string | null {
    if (!input || typeof input !== 'string') return null
    const digits = input.replace(/\D/g, '')
    let d = digits
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
    if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) return d
    return null
}
