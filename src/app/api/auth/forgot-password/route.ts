import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { sendPasswordResetEmail } from '@/services/email.service'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const rawEmail = body?.email

        if (!rawEmail || typeof rawEmail !== 'string') {
            return NextResponse.json(
                { success: false, error: 'Email is required' },
                { status: 400 }
            )
        }

        const email = rawEmail.trim().toLowerCase()
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { success: false, error: 'Please enter a valid email address' },
                { status: 400 }
            )
        }

        const user = await prisma.user.findUnique({
            where: { email },
            // Keep this query stable even when new User fields are added.
            select: { id: true, email: true },
        })

        if (!user) {
            // Security: Don't reveal if user exists. Pretend success.
            // Wait a random time to prevent timing attacks
            await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500))
            return NextResponse.json({ success: true, message: 'If an account exists, email sent.' })
        }

        const token = crypto.randomBytes(32).toString('hex')
        const expires = new Date(new Date().getTime() + 3600 * 1000) // 1 hour

        // Keep only one active reset token per email.
        await prisma.verificationToken.deleteMany({
            where: { identifier: email }
        })

        await prisma.verificationToken.create({
            data: {
                identifier: email,
                token,
                expires
            }
        })

        const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin
        const hasSmtpCredentials = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD)

        if (!hasSmtpCredentials) {
            console.log('----------------------------------------------------')
            console.log('⚠️  SMTP_USER/SMTP_PASSWORD missing. Password reset email not sent.')
            console.log(`🔗  LINK: ${baseUrl}/reset-password?token=${token}`)
            console.log('----------------------------------------------------')

            return NextResponse.json({
                success: true,
                message: 'If an account exists, email sent.',
                ...(process.env.NODE_ENV !== 'production'
                    ? { devLink: `${baseUrl}/reset-password?token=${token}` }
                    : {}),
            })
        }

        const result = await sendPasswordResetEmail(email, token, baseUrl)

        if (!result.success) {
            console.error('Failed to send email:', result.error)

            return NextResponse.json({
                success: true,
                message: 'If an account exists, email sent.',
            })
        }

        return NextResponse.json({
            success: true,
            message: 'If an account exists, email sent.',
        })

    } catch (error: unknown) {
        console.error('Password Reset Error:', error)

        // Table missing / DB not migrated — common after deploy without migrate
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === 'P2021' || error.code === 'P2010')
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        'Password reset is not available right now (database not ready). Please try again after a few minutes or contact support.',
                },
                { status: 503 }
            )
        }

        const message =
            error instanceof Error ? error.message : 'Request failed'
        return NextResponse.json(
            {
                success: false,
                error:
                    process.env.NODE_ENV === 'development'
                        ? message
                        : 'Something went wrong. Please try again in a moment.',
            },
            { status: 500 }
        )
    }
}
