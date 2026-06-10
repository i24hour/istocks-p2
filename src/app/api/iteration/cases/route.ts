import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { loadIterationCases } from '@/lib/iteration-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitParam) ? limitParam : 50
  const offsetParam = Number(request.nextUrl.searchParams.get('offset') || '0')
  const offset = Number.isFinite(offsetParam) ? offsetParam : 0

  try {
    const cases = await loadIterationCases(limit, offset)
    return NextResponse.json({ success: true, data: cases })
  } catch (error: any) {
    console.error('Iteration cases error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load iteration cases' }, { status: 500 })
  }
}