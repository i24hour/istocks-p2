const DEFAULT_SITE_ORIGIN = 'https://istocks.codes'

function stripTrailingSlashes(uri: string): string {
    return uri.replace(/\/+$/, '')
}

/** Site origin for canonical URLs / Open Graph. Env wins when set at build time. */
export function getMetadataBaseURL(): URL {
    const raw =
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        process.env.NEXTAUTH_URL?.trim() ||
        DEFAULT_SITE_ORIGIN
    const normalized = stripTrailingSlashes(raw)
    try {
        return new URL(normalized)
    } catch {
        return new URL(DEFAULT_SITE_ORIGIN)
    }
}
