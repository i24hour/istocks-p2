import type { BrokerName, OrderSide, OrderType, ProductType } from '@/lib/trading/types'

export interface BrokerCredentials {
  apiKey?: string | null
  apiSecret?: string | null
  clientId?: string | null
  accessToken?: string | null
  tokenExpiresAt?: Date | null
  meta?: Record<string, unknown> | null
}

export interface BrokerStockMapping {
  symbol: string
  exchange?: string | null
  dhanSecurityId?: string | null
  zerodhaTradingSymbol?: string | null
  zerodhaExchange?: string | null
  growwTradingSymbol?: string | null
  growwExchange?: string | null
}

export interface BrokerConnectStartInput {
  state: string
  redirectUri: string
  credentials: BrokerCredentials
}

export interface BrokerConnectStartResult {
  redirectUrl: string
  meta?: Record<string, unknown>
}

export interface BrokerConnectCallbackInput {
  query: URLSearchParams
  redirectUri: string
  credentials: BrokerCredentials
}

export interface BrokerConnectCallbackResult {
  accessToken: string
  tokenExpiresAt?: Date | null
  meta?: Record<string, unknown>
}

export interface BrokerPlaceOrderInput {
  symbol: string
  side: OrderSide
  quantity: number
  orderType: OrderType
  productType: ProductType
  price?: number | null
  idempotencyKey: string
  stock: BrokerStockMapping
  credentials: BrokerCredentials
}

export interface BrokerPlaceOrderResult {
  brokerOrderId: string
  status: string
  raw: unknown
}

export interface BrokerHolding {
  symbol: string
  quantity: number
  averagePrice: number
  ltp: number
  investedValue: number
  currentValue: number
  pnl: number
  pnlPercent: number
  exchange?: string
}

export interface BrokerAdapter {
  name: BrokerName
  connectStart(input: BrokerConnectStartInput): Promise<BrokerConnectStartResult>
  connectCallback(input: BrokerConnectCallbackInput): Promise<BrokerConnectCallbackResult>
  refreshIfNeeded?(credentials: BrokerCredentials): Promise<BrokerCredentials>
  placeOrder(input: BrokerPlaceOrderInput): Promise<BrokerPlaceOrderResult>
  getHoldings?(credentials: BrokerCredentials): Promise<BrokerHolding[]>
}
