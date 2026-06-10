import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const token = typeof body?.token === 'string' ? body.token.trim() : ''
        const password = typeof body?.password === 'string' ? body.password : ''

        if (!token) {
            return NextResponse.json(
                { success: false, error: 'Reset token is required' },
                { status: 400 }
            )
        }

        if (!password || password.length < 8) {
            return NextResponse.json(
                { success: false, error: 'Password must be at least 8 characters' },
                { status: 400 }
            )
        }

        const resetToken = await prisma.verificationToken.findUnique({
            where: { token },
        })

        if (!resetToken) {
            return NextResponse.json(
                { success: false, error: 'Invalid or expired reset link' },
                { status: 400 }
            )
        }

        if (resetToken.expires < new Date()) {
            await prisma.verificationToken.deleteMany({
                where: { identifier: resetToken.identifier },
            })

            return NextResponse.json(
                { success: false, error: 'Reset link has expired' },
                { status: 400 }
            )
        }

        const user = await prisma.user.findUnique({
            where: { email: resetToken.identifier },
            select: { id: true },
        })

        if (!user) {
            await prisma.verificationToken.deleteMany({
                where: { identifier: resetToken.identifier },
            })

            return NextResponse.json(
                { success: false, error: 'Invalid reset request' },
                { status: 400 }
            )
        }

        const hashedPassword = await bcrypt.hash(password, 12)

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            }),
            prisma.verificationToken.deleteMany({
                where: { identifier: resetToken.identifier },
            }),
        ])

        return NextResponse.json({
            success: true,
            message: 'Password reset successful. You can now sign in.',
        })
    } catch (error: unknown) {
        console.error('Reset Password Error:', error)
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === 'P2021' || error.code === 'P2010')
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        'Service temporarily unavailable. Please try again in a few minutes.',
                },
                { status: 503 }
            )
        }
        return NextResponse.json(
            { success: false, error: 'Request failed' },
            { status: 500 }
        )
    }
}
