import { NextRequest, NextResponse } from 'next/server'
import { getStockDetails } from '@/lib/stock-service'

// Cache for 60 seconds
export const revalidate = 60

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params
    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('timeframe') || '1m'

    const data = await getStockDetails(symbol, timeframe)

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Stock not found or no data' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: data,
    })
  } catch (error: any) {
    console.error('Error fetching stock data:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock data', details: error.message },
      { status: 500 }
    )
  }
}
