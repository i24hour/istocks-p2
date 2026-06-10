import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const token = request.nextUrl.searchParams.get("token")

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Token is required" },
                { status: 400 }
            )
        }

        // Find verification token
        const verificationToken = await prisma.verificationToken.findUnique({
            where: { token }
        })

        if (!verificationToken) {
            return NextResponse.json(
                { success: false, error: "Invalid or expired token" },
                { status: 400 }
            )
        }

        // Check if expired
        if (verificationToken.expires < new Date()) {
            await prisma.verificationToken.delete({
                where: { token }
            })
            return NextResponse.json(
                { success: false, error: "Token has expired. Please sign up again." },
                { status: 400 }
            )
        }

        // Update user as verified
        await prisma.user.update({
            where: { email: verificationToken.identifier },
            data: { emailVerified: new Date() }
        })

        // Delete the token
        await prisma.verificationToken.delete({
            where: { token }
        })

        return NextResponse.json({
            success: true,
            message: "Email verified successfully! You can now login.",
        })
    } catch (error) {
        console.error("Verify email error:", error)
        return NextResponse.json(
            { success: false, error: "Failed to verify email" },
            { status: 500 }
        )
    }
}
