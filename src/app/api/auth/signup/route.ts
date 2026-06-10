import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { sendVerificationEmail } from "@/services/email.service"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { name, email, password } = body

        // Validation
        if (!email || !password) {
            return NextResponse.json(
                { success: false, error: "Email and password are required" },
                { status: 400 }
            )
        }

        if (password.length < 8) {
            return NextResponse.json(
                { success: false, error: "Password must be at least 8 characters" },
                { status: 400 }
            )
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        })

        if (existingUser) {
            return NextResponse.json(
                { success: false, error: "Email already registered" },
                { status: 400 }
            )
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12)

        // Create user - AUTO-VERIFY for now (no email verification required)
        const user = await prisma.user.create({
            data: {
                name: name || email.split("@")[0],
                email,
                password: hashedPassword,
                emailVerified: new Date(), // Auto-verify the email
            }
        })

        // Try to send verification email, but don't fail if it doesn't work
        try {
            if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
                const verificationToken = crypto.randomBytes(32).toString("hex")
                const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

                await prisma.verificationToken.create({
                    data: {
                        identifier: email,
                        token: verificationToken,
                        expires,
                    }
                })

                await sendVerificationEmail(email, verificationToken)
                console.log("Verification email sent to:", email)
            } else {
                console.log("SMTP not configured, skipping verification email")
            }
        } catch (emailError) {
            console.error("Failed to send verification email:", emailError)
            // Don't fail signup if email fails
        }

        return NextResponse.json({
            success: true,
            message: "Account created successfully! You can now sign in.",
            userId: user.id,
        })
    } catch (error: any) {
        console.error("Signup error:", error)
        // Return more detailed error in development/debug
        const errorMessage = error?.message || "Unknown error"
        const errorCode = error?.code || "UNKNOWN"
        return NextResponse.json(
            {
                success: false,
                error: `Failed to create account: ${errorMessage}`,
                code: errorCode,
                details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
            },
            { status: 500 }
        )
    }
}

