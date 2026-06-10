import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '@/lib/auth'
import { checkAndIncrementAttachLimit } from '@/lib/attach-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let fileCount = 1
  try {
    const body = await request.json().catch(() => ({}))
    const n = Number(body?.count)
    if (Number.isFinite(n) && n > 0) fileCount = Math.min(20, Math.floor(n))
  } catch {
    /* default 1 */
  }

  const result = await checkAndIncrementAttachLimit(session.user.id, fileCount)
  if (!result.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: result.available
          ? 'Pro attachment limit reached (5 files per 30-day Pro period).'
          : 'File attachments are available on Pro only.',
        data: result,
      },
      { status: 429 }
    )
  }

  return NextResponse.json({ success: true, data: result })
}
