import { NextResponse } from 'next/server'
import { clearInternalSessionCookie } from '@/lib/internal-auth'

export const runtime = 'nodejs'

export async function POST() {
    const response = NextResponse.json({ success: true })
    return clearInternalSessionCookie(response)
}
