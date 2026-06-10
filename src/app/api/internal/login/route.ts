import { NextResponse } from 'next/server'
import {
    applyInternalSessionCookie,
    createInternalSessionToken,
    verifyInternalCredentials,
} from '@/lib/internal-auth'

export const runtime = 'nodejs'

export async function POST(request: Request) {
    let body: { username?: string; password?: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const username = body.username?.trim() ?? ''
    const password = body.password ?? ''

    if (!username || !password) {
        return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
    }

    if (!verifyInternalCredentials(username, password)) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = createInternalSessionToken(username)
    const response = NextResponse.json({ success: true })
    return applyInternalSessionCookie(response, token)
}
