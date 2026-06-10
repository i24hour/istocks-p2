import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/share/[shareId] — public, no auth required
export async function GET(
  _req: NextRequest,
  { params }: { params: { shareId: string } }
) {
  const session = await prisma.chatSession.findUnique({
    where: { shareId: params.shareId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      user: { select: { name: true } },
      messages: {
        select: { id: true, role: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!session) {
    return NextResponse.json({ success: false, error: 'Share not found' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    data: {
      title: session.title || 'Shared conversation',
      createdAt: session.createdAt,
      author: session.user?.name || null,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    },
  })
}
