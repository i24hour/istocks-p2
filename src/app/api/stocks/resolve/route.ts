import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { buildStockQueryCandidates, normalizeStockQuery, resolveClosestStocks } from '@/lib/stock-resolver'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const authSession = await getAuthSession()
    if (!authSession?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const q = request.nextUrl.searchParams.get('q')?.trim() || ''
    if (!q) {
      return NextResponse.json({ success: false, error: 'q is required' }, { status: 400 })
    }

    const queryNorm = normalizeStockQuery(q)
    const queryCandidates = buildStockQueryCandidates(q)
    if (!queryNorm || queryCandidates.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid query' }, { status: 400 })
    }

    const scored = await resolveClosestStocks(q, 5)
    if (scored.length === 0) {
      return NextResponse.json({ success: true, data: null, matches: [] })
    }

    return NextResponse.json({
      success: true,
      data: scored[0],
      matches: scored.slice(0, 5),
    })
  } catch (error: any) {
    console.error('Error resolving stock symbol:', error)
    return NextResponse.json({ success: false, error: 'Failed to resolve symbol' }, { status: 500 })
  }
}
