export const BROKER_NAMES = ['ZERODHA', 'DHAN', 'GROWW', 'ANGELONE'] as const
export type BrokerName = (typeof BROKER_NAMES)[number]

export const TRADING_MODES = ['PAPER', 'LIVE'] as const
export type TradingMode = (typeof TRADING_MODES)[number]

export const ORDER_SIDES = ['BUY', 'SELL'] as const
export type OrderSide = (typeof ORDER_SIDES)[number]

export const PRODUCT_TYPES = ['INTRADAY', 'DELIVERY'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export interface TradeExecutionRequest {
  symbol: string
  side: OrderSide
  quantity: number
  mode?: TradingMode
  productType?: ProductType
  orderType?: OrderType
  price?: number | null
  confirmed?: boolean
  idempotencyKey?: string
  brokerName?: BrokerName
  sessionId?: string
  userPrompt?: string
  targetProfitPct?: number
  strategyParams?: Array<{ key: string; label: string; value: string }>
  conditions?: Array<any>
}

export interface TradeExecutionResult {
  success: boolean
  mode: TradingMode
  symbol: string
  side: OrderSide
  quantity: number
  brokerName?: BrokerName
  orderId: string
  brokerOrderId?: string
  executedPrice?: number | null
  status: string
  message: string
  deferred?: boolean
  deferredReason?: string
  rawBrokerResponse?: unknown
}

export const isBrokerName = (value: string | null | undefined): value is BrokerName =>
  !!value && (BROKER_NAMES as readonly string[]).includes(value)

export const isTradingMode = (value: string | null | undefined): value is TradingMode =>
  !!value && (TRADING_MODES as readonly string[]).includes(value)

export const normalizeMode = (value: string | null | undefined): TradingMode =>
  isTradingMode(value) ? value : 'PAPER'

export const normalizeOrderType = (value: string | null | undefined): OrderType =>
  value === 'LIMIT' ? 'LIMIT' : 'MARKET'

export const normalizeProductType = (value: string | null | undefined): ProductType =>
  value === 'DELIVERY' ? 'DELIVERY' : 'INTRADAY'
