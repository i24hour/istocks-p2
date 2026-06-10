import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Ping endpoint to keep Azure PostgreSQL from sleeping
// Called every 10 minutes by Vercel Cron

export async function GET(request: Request) {
    // Verify cron secret (optional)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        // Allow without secret too for testing
        console.log('Cron ping called (no auth)')
    }

    try {
        // Simple query to keep database awake
        const result = await prisma.$queryRaw`SELECT 1 as ping`

        console.log('🏓 Database ping successful - keeping Azure PostgreSQL awake')

        return NextResponse.json({
            success: true,
            message: 'Database ping successful',
            timestamp: new Date().toISOString(),
        })
    } catch (error: any) {
        console.error('❌ Database ping failed:', error.message)

        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 })
    }
}
