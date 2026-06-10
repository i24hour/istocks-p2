/**
 * GET /api/telegram/set-webhook?secret=YOUR_SECRET
 *
 * One-time setup: registers the webhook URL with Telegram.
 * Call this once after deploying to set up the bot.
 *
 * Query params:
 *   secret — must match TELEGRAM_WEBHOOK_SETUP_SECRET env var (prevents random calls)
 *   action — "set" (default) | "delete" | "info"
 */

import { NextRequest, NextResponse } from 'next/server'
import { setWebhook, deleteWebhook, getWebhookInfo } from '@/lib/telegram'

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const action = searchParams.get('action') || 'set'

    // Verify setup secret
    const setupSecret = process.env.TELEGRAM_WEBHOOK_SETUP_SECRET
    if (!setupSecret || secret !== setupSecret) {
        return NextResponse.json({ error: 'Invalid setup secret' }, { status: 403 })
    }

    try {
        if (action === 'delete') {
            const result = await deleteWebhook()
            return NextResponse.json({ action: 'delete', result })
        }

        if (action === 'info') {
            const result = await getWebhookInfo()
            return NextResponse.json({ action: 'info', result })
        }

        // Default: set webhook
        // Use www.istocks.codes explicitly — non-www does a 307 redirect which Telegram rejects
        const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || process.env.VERCEL_URL
        if (!baseUrl) {
            return NextResponse.json({ error: 'NEXTAUTH_URL or VERCEL_URL not configured' }, { status: 500 })
        }

        let fullBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
        // Ensure www prefix for istocks.codes (non-www redirects with 307)
        fullBase = fullBase.replace('://istocks.codes', '://www.istocks.codes')
        const webhookUrl = `${fullBase}/api/telegram/webhook`

        const result = await setWebhook(webhookUrl)
        return NextResponse.json({
            action: 'set',
            webhookUrl,
            result,
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
