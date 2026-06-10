import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeIndianMobile } from '@/lib/phone'

export const runtime = 'nodejs'

/** GET — return { phone } for pre-filling checkout (phone is not secret but we only expose to owner) */
export async function GET() {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { phone: true },
    })
    return NextResponse.json({ phone: user?.phone ?? null })
}

/** PATCH — body: { phone: string } — 10-digit Indian mobile */
export async function PATCH(request: NextRequest) {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json().catch(() => null)
    const raw = typeof body?.phone === 'string' ? body.phone : ''
    const phone = normalizeIndianMobile(raw)
    if (!phone) {
        return NextResponse.json(
            { error: 'Enter a valid 10-digit Indian mobile number' },
            { status: 400 }
        )
    }
    await prisma.user.update({
        where: { id: session.user.id },
        data: { phone },
    })
    return NextResponse.json({ success: true, phone })
}
