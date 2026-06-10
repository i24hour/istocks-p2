import { NextRequest, NextResponse } from 'next/server'
import { classifyPortfolioIntent } from '@/lib/intent-classifier'

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ isPersonalPortfolio: false })
    }
    const isPersonalPortfolio = await classifyPortfolioIntent(message)
    return NextResponse.json({ isPersonalPortfolio })
  } catch {
    return NextResponse.json({ isPersonalPortfolio: false })
  }
}
