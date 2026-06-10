import crypto from 'node:crypto'

const PROXY_URL = process.env.BROKER_PROXY_URL || ''
const PROXY_SECRET = process.env.BROKER_PROXY_SECRET || ''

interface ProxiedResponse {
    status: number
    headers: Record<string, string>
    body: string
}

/**
 * Drop-in replacement for `fetch` that routes broker API calls through the
 * Azure Container Apps proxy so requests originate from the static IP
 * (4.224.60.60) registered with brokers like Groww.
 *
 * Falls back to direct fetch if proxy env vars are not configured (e.g. local dev).
 */
export async function brokerFetch(input: string, init: RequestInit = {}): Promise<Response> {
    if (!PROXY_URL || !PROXY_SECRET) {
        return fetch(input, init)
    }

    const method = (init.method || 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    if (init.headers) {
        const h = init.headers as Record<string, string> | Headers
        if (h instanceof Headers) {
            h.forEach((v, k) => { headers[k] = v })
        } else if (Array.isArray(h)) {
            for (const [k, v] of h as unknown as [string, string][]) headers[k] = v
        } else {
            Object.assign(headers, h)
        }
    }

    let body: string | null = null
    if (init.body != null && method !== 'GET' && method !== 'HEAD') {
        body = typeof init.body === 'string' ? init.body : String(init.body)
    }

    const payload = JSON.stringify({ method, url: input, headers, body })
    const ts = Date.now().toString()
    const signature = crypto
        .createHmac('sha256', PROXY_SECRET)
        .update(`${ts}.${payload}`)
        .digest('hex')

    const proxyResp = await fetch(`${PROXY_URL.replace(/\/$/, '')}/proxy`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-proxy-signature': signature,
            'x-proxy-timestamp': ts,
        },
        body: payload,
    })

    if (!proxyResp.ok) {
        const errBody = await proxyResp.text()
        throw new Error(`broker-proxy ${proxyResp.status}: ${errBody}`)
    }

    const data = (await proxyResp.json()) as ProxiedResponse
    return new Response(data.body, {
        status: data.status,
        headers: data.headers,
    })
}
