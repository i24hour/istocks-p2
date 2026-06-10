import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Cashfree checkout removed — use POST /api/create-order (Razorpay). */
export async function POST() {
    return NextResponse.json(
        { error: 'Cashfree checkout is disabled. Use POST /api/create-order for Razorpay checkout.' },
        { status: 410 }
    )
}
