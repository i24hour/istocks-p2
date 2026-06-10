'use client'

import { useState } from 'react'
import { X, TrendingUp, TrendingDown, Shield, Target, Zap } from 'lucide-react'

interface TradeExecutionModalProps {
    isOpen: boolean
    onClose: () => void
    symbol: string
    suggestedAction?: 'BUY' | 'SELL'
    suggestedCondition?: {
        indicator: string
        operator: string
        value: number
    }
    currentPrice?: number
}

type TradingMode = 'PAPER' | 'REAL'
type ProductType = 'INTRADAY' | 'CNC' | 'FNO_FUT' | 'FNO_OPT'

export default function TradeExecutionModal({
    isOpen,
    onClose,
    symbol,
    suggestedAction = 'BUY',
    suggestedCondition,
    currentPrice = 0
}: TradeExecutionModalProps) {
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Form state
    const [tradingMode, setTradingMode] = useState<TradingMode>('PAPER')
    const [orderType, setOrderType] = useState<'BUY' | 'SELL'>(suggestedAction)
    const [productType, setProductType] = useState<ProductType>('INTRADAY')
    const [quantity, setQuantity] = useState(1)
    const [entryPrice, setEntryPrice] = useState<number | undefined>(currentPrice)
    const [stopLoss, setStopLoss] = useState<number | undefined>()
    const [takeProfit, setTakeProfit] = useState<number | undefined>()
    const [useCondition, setUseCondition] = useState(!!suggestedCondition)
    const [condition, setCondition] = useState(suggestedCondition || {
        indicator: 'RSI',
        operator: '<',
        value: 30
    })

    const positionValue = (entryPrice || currentPrice) * quantity

    const handleSubmit = async () => {
        setLoading(true)
        setError(null)

        try {
            const res = await fetch('/api/trading/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol,
                    orderType,
                    productType,
                    quantity,
                    entryCondition: useCondition ? condition : null,
                    entryPrice: useCondition ? null : entryPrice,
                    stopLoss,
                    takeProfit,
                    positionValue,
                    tradingMode
                })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to create order')
            }

            setSuccess(true)
            setTimeout(() => {
                onClose()
                setSuccess(false)
            }, 2000)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-dark-100 border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Zap className="w-5 h-5 text-emerald-400" />
                        Execute Trade
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Success Message */}
                {success && (
                    <div className="p-4 bg-emerald-500/20 border-b border-emerald-500/30">
                        <p className="text-emerald-400 text-center font-medium">
                            ✅ Order created successfully!
                        </p>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div className="p-4 bg-red-500/20 border-b border-red-500/30">
                        <p className="text-red-400 text-center text-sm">{error}</p>
                    </div>
                )}

                <div className="p-4 space-y-4">
                    {/* Symbol Display */}
                    <div className="bg-dark-400/50 rounded-xl p-4 flex items-center justify-between">
                        <div>
                            <span className="text-lg font-bold text-white">{symbol}</span>
                            <p className="text-sm text-gray-400">Current: ₹{currentPrice.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                            <span className="text-sm text-gray-400">Position Value</span>
                            <p className="text-lg font-bold text-emerald-400">₹{positionValue.toLocaleString('en-IN')}</p>
                        </div>
                    </div>

                    {/* Trading Mode Toggle */}
                    <div className="flex rounded-xl overflow-hidden border border-white/10">
                        <button
                            onClick={() => setTradingMode('PAPER')}
                            className={`flex-1 py-2.5 text-sm font-medium transition-all ${tradingMode === 'PAPER'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-dark-400/30 text-gray-400'
                                }`}
                        >
                            📝 Paper Trade
                        </button>
                        <button
                            onClick={() => setTradingMode('REAL')}
                            className={`flex-1 py-2.5 text-sm font-medium transition-all ${tradingMode === 'REAL'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-dark-400/30 text-gray-400'
                                }`}
                        >
                            💰 Real Trade
                        </button>
                    </div>

                    {/* Buy/Sell Toggle */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setOrderType('BUY')}
                            className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${orderType === 'BUY'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-dark-400/50 text-gray-400 border border-white/5'
                                }`}
                        >
                            <TrendingUp className="w-4 h-4" /> BUY
                        </button>
                        <button
                            onClick={() => setOrderType('SELL')}
                            className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${orderType === 'SELL'
                                    ? 'bg-red-500 text-white'
                                    : 'bg-dark-400/50 text-gray-400 border border-white/5'
                                }`}
                        >
                            <TrendingDown className="w-4 h-4" /> SELL
                        </button>
                    </div>

                    {/* Product Type */}
                    <div>
                        <label className="text-sm text-gray-400 mb-2 block">Product Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(['INTRADAY', 'CNC', 'FNO_FUT', 'FNO_OPT'] as ProductType[]).map(pt => (
                                <button
                                    key={pt}
                                    onClick={() => setProductType(pt)}
                                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${productType === pt
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'bg-dark-400/30 text-gray-400 border border-white/5'
                                        }`}
                                >
                                    {pt.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Quantity */}
                    <div>
                        <label className="text-sm text-gray-400 mb-2 block">Quantity</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-dark-400/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            min={1}
                        />
                    </div>

                    {/* Condition Toggle */}
                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="useCondition"
                            checked={useCondition}
                            onChange={(e) => setUseCondition(e.target.checked)}
                            className="w-4 h-4 rounded bg-dark-400 border-white/20"
                        />
                        <label htmlFor="useCondition" className="text-sm text-gray-300">
                            Execute when condition is met
                        </label>
                    </div>

                    {/* Condition Inputs */}
                    {useCondition ? (
                        <div className="grid grid-cols-3 gap-2">
                            <select
                                value={condition.indicator}
                                onChange={(e) => setCondition(c => ({ ...c, indicator: e.target.value }))}
                                className="bg-dark-400/50 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm"
                            >
                                <option value="RSI">RSI</option>
                                <option value="PRICE">Price</option>
                                <option value="SMA20">SMA 20</option>
                                <option value="MACD">MACD</option>
                            </select>
                            <select
                                value={condition.operator}
                                onChange={(e) => setCondition(c => ({ ...c, operator: e.target.value }))}
                                className="bg-dark-400/50 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm"
                            >
                                <option value="<">&lt;</option>
                                <option value=">">&gt;</option>
                                <option value="==">=</option>
                                <option value="CROSSES_ABOVE">Crosses ↑</option>
                                <option value="CROSSES_BELOW">Crosses ↓</option>
                            </select>
                            <input
                                type="number"
                                value={condition.value}
                                onChange={(e) => setCondition(c => ({ ...c, value: parseFloat(e.target.value) || 0 }))}
                                className="bg-dark-400/50 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm"
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="text-sm text-gray-400 mb-2 block">Entry Price (Limit)</label>
                            <input
                                type="number"
                                value={entryPrice}
                                onChange={(e) => setEntryPrice(parseFloat(e.target.value) || undefined)}
                                placeholder="Market order if empty"
                                className="w-full bg-dark-400/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                    )}

                    {/* Risk Management */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-gray-400 mb-2 flex items-center gap-1">
                                <Shield className="w-3 h-3 text-red-400" /> Stop Loss
                            </label>
                            <input
                                type="number"
                                value={stopLoss || ''}
                                onChange={(e) => setStopLoss(parseFloat(e.target.value) || undefined)}
                                placeholder="₹"
                                className="w-full bg-dark-400/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                        </div>
                        <div>
                            <label className="text-sm text-gray-400 mb-2 flex items-center gap-1">
                                <Target className="w-3 h-3 text-emerald-400" /> Take Profit
                            </label>
                            <input
                                type="number"
                                value={takeProfit || ''}
                                onChange={(e) => setTakeProfit(parseFloat(e.target.value) || undefined)}
                                placeholder="₹"
                                className="w-full bg-dark-400/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`w-full py-4 rounded-xl font-semibold text-white transition-all ${orderType === 'BUY'
                                ? 'bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400'
                                : 'bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400'
                            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {loading ? 'Creating Order...' : `${orderType} ${symbol}`}
                    </button>

                    <p className="text-xs text-center text-gray-500">
                        {tradingMode === 'PAPER'
                            ? '📝 This is a paper trade (simulated)'
                            : '⚠️ This will execute a real trade using your broker API'
                        }
                    </p>
                </div>
            </div>
        </div>
    )
}
