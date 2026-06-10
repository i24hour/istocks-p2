import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'

// GET /api/sangraha - List strategies
export async function GET(request: NextRequest) {
    try {
        const session = await getAuthSession()
        const searchParams = request.nextUrl.searchParams

        const filter = searchParams.get('filter') || 'all' // 'all' | 'mine' | 'starred'
        const type = searchParams.get('type') // strategy type filter
        const stock = searchParams.get('stock') // stock symbol filter
        const search = searchParams.get('search') // search query

        // Build where clause
        const where: any = {}

        if (filter === 'mine') {
            if (!session?.user?.id) {
                return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
            }
            where.authorId = session.user.id
        } else if (filter === 'starred') {
            if (!session?.user?.id) {
                return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
            }
            where.starredBy = { some: { userId: session.user.id } }
        } else {
            // Show public strategies OR user's own
            where.OR = [
                { visibility: 'public' },
                ...(session?.user?.id ? [{ authorId: session.user.id }] : [])
            ]
        }

        if (type) {
            where.strategyType = type
        }

        if (stock) {
            where.stockSymbol = stock.toUpperCase()
        }

        if (search) {
            where.AND = [
                ...(where.AND || []),
                {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                        { tags: { has: search.toLowerCase() } }
                    ]
                }
            ]
        }

        const strategies = await prisma.strategy.findMany({
            where,
            include: {
                author: {
                    select: { id: true, name: true, image: true }
                },
                _count: {
                    select: { backtests: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        })

        // Check if current user has starred each strategy
        let starredIds: Set<string> = new Set()
        if (session?.user?.id) {
            const userStars = await prisma.strategyStar.findMany({
                where: {
                    userId: session.user.id,
                    strategyId: { in: strategies.map(s => s.id) }
                }
            })
            starredIds = new Set(userStars.map(s => s.strategyId))
        }

        const strategiesWithStarred = strategies.map(s => ({
            ...s,
            isStarred: starredIds.has(s.id),
            backtestCount: s._count.backtests
        }))

        return NextResponse.json({
            success: true,
            data: strategiesWithStarred
        })
    } catch (error) {
        console.error('Error fetching strategies:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch strategies' },
            { status: 500 }
        )
    }
}

// POST /api/sangraha - Create strategy
export async function POST(request: NextRequest) {
    try {
        const session = await getAuthSession()

        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, error: 'Authentication required' },
                { status: 401 }
            )
        }

        const body = await request.json()
        const {
            name,
            description,
            readme,
            naturalInput,
            strategyCode,
            sqlQuery,
            stockSymbol,
            strategyType,
            tags,
            visibility
        } = body

        // Validation
        if (!name || !naturalInput || !strategyCode) {
            return NextResponse.json(
                { success: false, error: 'Name, naturalInput, and strategyCode are required' },
                { status: 400 }
            )
        }

        // Generate README if not provided
        const generatedReadme = readme || `# ${name}

## Strategy Description
${description || 'No description provided.'}

## Original Query
\`\`\`
${naturalInput}
\`\`\`

## How It Works
This strategy was created from a natural language query and converted into executable conditions.

## Tags
${(tags || []).map((t: string) => `- ${t}`).join('\n') || 'No tags'}

## Created
${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
`

        const strategy = await prisma.strategy.create({
            data: {
                name,
                description: description || '',
                readme: generatedReadme,
                naturalInput,
                strategyCode,
                sqlQuery: sqlQuery || null,
                stockSymbol: stockSymbol?.toUpperCase() || null,
                strategyType: strategyType || 'indicator',
                tags: tags || [],
                visibility: visibility || 'private',
                authorId: session.user.id
            },
            include: {
                author: {
                    select: { id: true, name: true, image: true }
                }
            }
        })

        return NextResponse.json({
            success: true,
            data: strategy
        })
    } catch (error) {
        console.error('Error creating strategy:', error)
        return NextResponse.json(
            { success: false, error: 'Failed to create strategy' },
            { status: 500 }
        )
    }
}
