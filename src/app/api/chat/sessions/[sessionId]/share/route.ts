import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/auth'
import { randomBytes } from 'crypto'

function generateShareId(): string {
  return randomBytes(8).toString('hex') // 16-char hex, e.g. "a3f2b1c4d5e6f7a8"
}

// POST /api/chat/sessions/[sessionId]/share — create or return existing share link
export async function POST(
  _req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const auth = await getAuthSession()
  if (!auth?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const session = await prisma.chatSession.findFirst({
    where: { id: params.sessionId, userId: auth.user.id } as any,
    select: { id: true, shareId: true },
  })
  if (!session) {
    return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
  }

  // Reuse existing shareId if already shared
  const shareId = session.shareId ?? generateShareId()

  if (!session.shareId) {
    await prisma.chatSession.update({
      where: { id: params.sessionId },
      data: { shareId },
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://istocks.codes'
  return NextResponse.json({ success: true, shareId, url: `${baseUrl}/share/${shareId}` })
}

// DELETE /api/chat/sessions/[sessionId]/share — revoke share link
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const auth = await getAuthSession()
  if (!auth?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  await prisma.chatSession.updateMany({
    where: { id: params.sessionId, userId: auth.user.id } as any,
    data: { shareId: null },
  })

  return NextResponse.json({ success: true })
}
