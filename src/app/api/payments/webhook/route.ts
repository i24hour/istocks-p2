import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Cashfree webhooks removed — Razorpay uses client-side signature verification. */
export async function POST() {
    return NextResponse.json({ error: 'Cashfree webhooks are disabled.' }, { status: 410 })
}
