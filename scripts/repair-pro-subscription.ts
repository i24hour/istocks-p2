/**
 * Repair Pro subscription from the latest successful payment.
 *
 * Use when a user paid but has no ACTIVE subscription (e.g. webhook/verify race).
 *
 *   DATABASE_URL="..." npx tsx scripts/repair-pro-subscription.ts "email@domain.com"
 *   DATABASE_URL="..." npx tsx scripts/repair-pro-subscription.ts "nikhlesh"
 *
 * The argument matches email or name (case-insensitive contains).
 */
import { prisma } from '../src/lib/prisma'
import { activateProSubscription, getUserPlan } from '../src/lib/subscription'

async function main() {
    const q = process.argv[2]?.trim()
    if (!q) {
        console.error('Usage: npx tsx scripts/repair-pro-subscription.ts <email-or-name>')
        process.exit(1)
    }

    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
            ],
        },
        select: { id: true, email: true, name: true },
    })

    if (!user) {
        console.error(`No user found matching: ${q}`)
        process.exit(1)
    }

    const payment = await prisma.payment.findFirst({
        where: {
            userId: user.id,
            status: 'SUCCESS',
        },
        orderBy: { updatedAt: 'desc' },
    })

    if (!payment) {
        console.error(`No SUCCESS payment for ${user.email} (${user.name ?? 'no name'})`)
        process.exit(1)
    }

    const planNorm = String(payment.plan).toLowerCase()
    if (planNorm !== 'pro') {
        console.error(`Latest SUCCESS payment plan is "${payment.plan}", not pro. Aborting.`)
        process.exit(1)
    }

    console.log(`Repairing: ${user.email} | order ${payment.paymentOrderId}`)
    await activateProSubscription(user.id, payment.paymentOrderId)
    const plan = await getUserPlan(user.id)
    console.log(`Done. getUserPlan → ${plan}`)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
