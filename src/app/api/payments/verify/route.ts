import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Cashfree verification removed — use POST /api/verify-payment (Razorpay). */
export async function GET() {
    return NextResponse.json(
        { error: 'Cashfree verification is disabled. Use POST /api/verify-payment for Razorpay.' },
        { status: 410 }
    )
}
