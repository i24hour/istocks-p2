import { dhanAdapter } from '@/lib/brokers/dhan.adapter'
import { growwAdapter } from '@/lib/brokers/groww.adapter'
import { zerodhaAdapter } from '@/lib/brokers/zerodha.adapter'
import { angelOneAdapter } from '@/lib/brokers/angelone.adapter'
import type { BrokerAdapter } from '@/lib/brokers/types'
import type { BrokerName } from '@/lib/trading/types'

export function getBrokerAdapter(broker: BrokerName): BrokerAdapter {
  if (broker === 'ZERODHA') return zerodhaAdapter
  if (broker === 'DHAN') return dhanAdapter
  if (broker === 'GROWW') return growwAdapter
  if (broker === 'ANGELONE') return angelOneAdapter
  throw new Error(`Unsupported broker: ${broker}`)
}
