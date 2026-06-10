/**
 * Internal admin session auth (separate from NextAuth user sessions).
 *
 * Production hardening: set INTERNAL_ADMIN_USER, INTERNAL_ADMIN_PASSWORD,
 * and INTERNAL_SESSION_SECRET in environment variables.
 */
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const INTERNAL_COOKIE = 'istocks_internal_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

export function getInternalAdminCredentials() {
    const username = process.env.INTERNAL_ADMIN_USER
    const password = process.env.INTERNAL_ADMIN_PASSWORD
    if (!username || !password) {
        throw new Error('INTERNAL_ADMIN_USER and INTERNAL_ADMIN_PASSWORD must be set')
    }
    return { username, password }
}

function getSessionSecret() {
    const secret = process.env.INTERNAL_SESSION_SECRET || process.env.NEXTAUTH_SECRET
    if (!secret) {
        throw new Error('INTERNAL_SESSION_SECRET or NEXTAUTH_SECRET must be set')
    }
    return secret
}

export function createInternalSessionToken(username: string): string {
    const payload = {
        username,
        exp: Date.now() + SESSION_TTL_MS,
    }
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url')
    return `${data}.${sig}`
}

export function verifyInternalSessionToken(token: string): { username: string } | null {
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [data, sig] = parts
    const expected = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url')

    if (sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null

    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
            username?: string
            exp?: number
        }
        if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
        if (typeof payload.username !== 'string') return null
        return { username: payload.username }
    } catch {
        return null
    }
}

export async function getInternalSession() {
    const cookieStore = await cookies()
    const token = cookieStore.get(INTERNAL_COOKIE)?.value
    if (!token) return null
    return verifyInternalSessionToken(token)
}

export function applyInternalSessionCookie(response: NextResponse, token: string) {
    response.cookies.set({
        name: INTERNAL_COOKIE,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
    })
    return response
}

export function clearInternalSessionCookie(response: NextResponse) {
    response.cookies.set({
        name: INTERNAL_COOKIE,
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    })
    return response
}

export async function requireInternalSession() {
    const session = await getInternalSession()
    if (!session) {
        return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    return { session, error: null }
}

export function verifyInternalCredentials(username: string, password: string): boolean {
    const creds = getInternalAdminCredentials()
    if (username !== creds.username || password !== creds.password) {
        return false
    }
    return true
}
