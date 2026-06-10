/**
 * GET /api/telegram/link?token=<token>
 *
 * Called when a logged-in user clicks the magic link from the Telegram bot.
 * Links their Telegram chatId to their istocks account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
        return NextResponse.redirect(new URL('/link-telegram?error=missing_token', request.url))
    }

    // Check user is logged in
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
        // Redirect to login, then back here
        const callbackUrl = encodeURIComponent(`/api/telegram/link?token=${token}`)
        return NextResponse.redirect(new URL(`/login?callbackUrl=${callbackUrl}`, request.url))
    }

    try {
        // Find token
        const linkToken = await prisma.telegramLinkToken.findUnique({
            where: { token },
        })

        if (!linkToken) {
            return NextResponse.redirect(new URL('/link-telegram?error=invalid_token', request.url))
        }

        if (linkToken.usedAt) {
            return NextResponse.redirect(new URL('/link-telegram?error=already_used', request.url))
        }

        if (linkToken.expiresAt < new Date()) {
            return NextResponse.redirect(new URL('/link-telegram?error=expired', request.url))
        }

        // Check if this Telegram chatId is already linked to a different account
        const existingUser = await prisma.user.findUnique({
            where: { telegramId: linkToken.chatId },
        })
        if (existingUser && existingUser.email !== session.user.email) {
            return NextResponse.redirect(new URL('/link-telegram?error=already_linked', request.url))
        }

        // Find the current user
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        })
        if (!user) {
            return NextResponse.redirect(new URL('/link-telegram?error=user_not_found', request.url))
        }

        // Link!
        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    telegramId: linkToken.chatId,
                    telegramLinkedAt: new Date(),
                },
            }),
            prisma.telegramLinkToken.update({
                where: { token },
                data: { usedAt: new Date() },
            }),
        ])

        return NextResponse.redirect(new URL('/link-telegram?success=1', request.url))
    } catch (err: any) {
        console.error('Telegram link error:', err)
        return NextResponse.redirect(new URL('/link-telegram?error=server_error', request.url))
    }
}
