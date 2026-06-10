'use server'

import { NextRequest } from 'next/server'
import { handleBrokerCallback } from '@/lib/trading/broker-connect'

export async function GET(request: NextRequest) {
  return handleBrokerCallback(request, 'ZERODHA', { requireState: true })
}
