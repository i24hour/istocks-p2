import express, { Request, Response, NextFunction } from 'express'
import crypto from 'node:crypto'

const PORT = Number(process.env.PORT || 3000)
const SHARED_SECRET = process.env.PROXY_SHARED_SECRET
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'api.groww.in,api.kite.trade,api.dhan.co,kite.zerodha.com,api.upstox.com')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)

if (!SHARED_SECRET) {
    console.error('FATAL: PROXY_SHARED_SECRET env var not set')
    process.exit(1)
}

const app = express()
app.use(express.json({ limit: '4mb' }))
app.use(express.text({ type: '*/*', limit: '4mb' }))

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'broker-proxy', allowedHosts: ALLOWED_HOSTS })
})

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
    } catch {
        return false
    }
}

function verifySignature(req: Request, res: Response, next: NextFunction): void {
    const sig = String(req.header('x-proxy-signature') || '')
    const ts = String(req.header('x-proxy-timestamp') || '')

    if (!sig || !ts) {
        res.status(401).json({ error: 'missing_signature' })
        return
    }

    const tsNum = Number(ts)
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 60_000) {
        res.status(401).json({ error: 'stale_or_invalid_timestamp' })
        return
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    const expected = crypto
        .createHmac('sha256', SHARED_SECRET!)
        .update(`${ts}.${rawBody}`)
        .digest('hex')

    if (!timingSafeEqualHex(sig, expected)) {
        res.status(401).json({ error: 'invalid_signature' })
        return
    }
    next()
}

interface ProxyRequest {
    method?: string
    url: string
    headers?: Record<string, string>
    body?: string | null
}

app.post('/proxy', verifySignature, async (req, res) => {
    let payload: ProxyRequest
    try {
        payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
        res.status(400).json({ error: 'invalid_json_body' })
        return
    }

    if (!payload?.url) {
        res.status(400).json({ error: 'missing_url' })
        return
    }

    let target: URL
    try {
        target = new URL(payload.url)
    } catch {
        res.status(400).json({ error: 'invalid_url' })
        return
    }

    if (target.protocol !== 'https:') {
        res.status(400).json({ error: 'https_required' })
        return
    }

    const host = target.hostname.toLowerCase()
    if (!ALLOWED_HOSTS.includes(host)) {
        res.status(403).json({ error: 'host_not_allowed', host })
        return
    }

    const method = (payload.method || 'GET').toUpperCase()
    const inboundHeaders = payload.headers || {}
    const forwardHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(inboundHeaders)) {
        const key = k.toLowerCase()
        if (['host', 'content-length', 'connection'].includes(key)) continue
        if (typeof v === 'string') forwardHeaders[k] = v
    }

    const start = Date.now()
    try {
        const upstream = await fetch(target.toString(), {
            method,
            headers: forwardHeaders,
            body: method === 'GET' || method === 'HEAD' ? undefined : payload.body ?? undefined,
        })

        const respText = await upstream.text()
        const respHeaders: Record<string, string> = {}
        upstream.headers.forEach((value, key) => {
            if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
                respHeaders[key] = value
            }
        })

        console.log(`[proxy] ${method} ${target.host}${target.pathname} → ${upstream.status} ${Date.now() - start}ms`)

        res.status(200).json({
            status: upstream.status,
            headers: respHeaders,
            body: respText,
        })
    } catch (err: any) {
        console.error(`[proxy] ${method} ${target.host}${target.pathname} → ERROR: ${err?.message}`)
        res.status(502).json({ error: 'upstream_error', message: err?.message })
    }
})

app.listen(PORT, () => {
    console.log(`[broker-proxy] listening on :${PORT}, hosts=${ALLOWED_HOSTS.join(',')}`)
})
