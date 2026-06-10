'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Indicator {
  name: string
  value: string
  signal: string
}

interface IndicatorsState {
  trend: Indicator[]
  momentum: Indicator[]
  volatility: Indicator[]
  volume: Indicator[]
}

interface TechnicalIndicatorsListProps {
  symbol: string
  initialData?: any
}

export default function TechnicalIndicatorsList({ symbol, initialData }: TechnicalIndicatorsListProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(!initialData)
  const [indicators, setIndicators] = useState<IndicatorsState>({
    trend: [], momentum: [], volatility: [], volume: []
  })

  useEffect(() => {
    if (initialData) {
      processData(initialData)
      setLoading(false)
    } else {
      fetchIndicators()
    }
  }, [symbol, initialData])

  const processData = (latest: any) => {
    const getSignal = (value: number | undefined, type: string) => {
      if (!value) return 'N/A'
      if (type === 'rsi') {
        if (value > 70) return 'Overbought'
        if (value < 30) return 'Oversold'
        return 'Neutral'
      }
      return 'Neutral'
    }

    setIndicators({
      trend: [
        { name: 'SMA 20', value: latest.sma20?.toFixed(2) || 'N/A', signal: latest.close > (latest.sma20 || 0) ? 'Bullish' : 'Bearish' },
        { name: 'SMA 50', value: latest.sma50?.toFixed(2) || 'N/A', signal: latest.close > (latest.sma50 || 0) ? 'Bullish' : 'Bearish' },
        { name: 'SMA 200', value: latest.sma200?.toFixed(2) || 'N/A', signal: latest.close > (latest.sma200 || 0) ? 'Bullish' : 'Bearish' },
        { name: 'EMA 12', value: latest.ema12?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'EMA 26', value: latest.ema26?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'MACD', value: latest.macd?.toFixed(2) || 'N/A', signal: (latest.macd || 0) > 0 ? 'Bullish' : 'Bearish' },
        { name: 'MACD Signal', value: latest.macdSignal?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'ADX', value: latest.adx?.toFixed(2) || 'N/A', signal: (latest.adx || 0) > 25 ? 'Strong Trend' : 'Weak Trend' },
      ],
      momentum: [
        { name: 'RSI', value: latest.rsi?.toFixed(2) || 'N/A', signal: getSignal(latest.rsi, 'rsi') },
        { name: 'Stochastic K', value: latest.stochK?.toFixed(2) || 'N/A', signal: (latest.stochK || 0) > 80 ? 'Overbought' : (latest.stochK || 0) < 20 ? 'Oversold' : 'Neutral' },
        { name: 'Stochastic D', value: latest.stochD?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'CCI', value: latest.cci?.toFixed(2) || 'N/A', signal: (latest.cci || 0) > 100 ? 'Overbought' : (latest.cci || 0) < -100 ? 'Oversold' : 'Neutral' },
        { name: 'Williams %R', value: latest.williamsR?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'ROC', value: latest.roc ? `${latest.roc.toFixed(2)}%` : 'N/A', signal: (latest.roc || 0) > 0 ? 'Bullish' : 'Bearish' },
      ],
      volatility: [
        { name: 'Bollinger Upper', value: latest.bbUpper?.toFixed(2) || 'N/A', signal: 'Resistance' },
        { name: 'Bollinger Middle', value: latest.bbMiddle?.toFixed(2) || 'N/A', signal: 'Neutral' },
        { name: 'Bollinger Lower', value: latest.bbLower?.toFixed(2) || 'N/A', signal: 'Support' },
        { name: 'ATR', value: latest.atr?.toFixed(2) || 'N/A', signal: (latest.atr || 0) > 5 ? 'High' : 'Medium' },
      ],
      volume: [
        { name: 'OBV', value: latest.obv ? `${(Number(latest.obv) / 1000000).toFixed(2)}M` : 'N/A', signal: 'Neutral' },
        { name: 'VWAP', value: latest.vwap?.toFixed(2) || 'N/A', signal: latest.close > (latest.vwap || 0) ? 'Bullish' : 'Bearish' },
        { name: 'Force Index', value: latest.forceIndex?.toFixed(0) || 'N/A', signal: (latest.forceIndex || 0) > 0 ? 'Bullish' : 'Bearish' },
        { name: 'A/D Line', value: latest.adLine?.toFixed(0) || 'N/A', signal: 'Neutral' },
      ],
    })
  }

  const fetchIndicators = async () => {
    try {
      const response = await fetch(`/api/stocks/${symbol}/data?timeframe=1m`)
      const result = await response.json()

      if (result.success && result.data.latestIndicatorData) {
        processData(result.data.latestIndicatorData)
      } else if (result.success && result.data.priceData.length > 0) {
        // Fallback if API hasn't updated yet (though it should have)
        processData(result.data.priceData[result.data.priceData.length - 1])
      }
    } catch (error) {
      console.error('Error fetching indicators:', error)
    } finally {
      setLoading(false)
    }
  }

  const getSignalColor = (signal: string) => {
    if (signal.includes('Bullish') || signal.includes('Overbought') || signal.includes('Support')) return 'text-emerald-400'
    if (signal.includes('Bearish') || signal.includes('Oversold') || signal.includes('Resistance')) return 'text-red-400'
    return 'text-gray-400'
  }

  const getSignalBg = (signal: string) => {
    if (signal.includes('Bullish') || signal.includes('Overbought') || signal.includes('Support')) return 'bg-emerald-500/20 border-emerald-500/30'
    if (signal.includes('Bearish') || signal.includes('Oversold') || signal.includes('Resistance')) return 'bg-red-500/20 border-red-500/30'
    return 'bg-dark-400/50 border-white/10'
  }

  const IndicatorCard = ({ indicator }: { indicator: { name: string; value: string; signal: string } }) => (
    <div className="flex items-center justify-between p-3 bg-dark-400/30 rounded-xl border border-white/5">
      <div>
        <p className="text-sm font-medium text-white">{indicator.name}</p>
        <p className="text-xs text-gray-500">{indicator.value}</p>
      </div>
      <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${getSignalBg(indicator.signal)} ${getSignalColor(indicator.signal)}`}>
        {indicator.signal}
      </span>
    </div>
  )

  return (
    <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Technical Indicators (40+)</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
        >
          {expanded ? 'Show Less' : 'Show All'}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <div className="space-y-6">
        {/* Trend Indicators */}
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full" />
            Trend Indicators
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {indicators.trend.slice(0, expanded ? undefined : 4).map((indicator, idx) => (
              <IndicatorCard key={idx} indicator={indicator} />
            ))}
          </div>
        </div>

        {/* Momentum Indicators */}
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <div className="w-2 h-2 bg-orange-400 rounded-full" />
            Momentum Indicators
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {indicators.momentum.slice(0, expanded ? undefined : 4).map((indicator, idx) => (
              <IndicatorCard key={idx} indicator={indicator} />
            ))}
          </div>
        </div>

        {expanded && (
          <>
            {/* Volatility Indicators */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full" />
                Volatility Indicators
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {indicators.volatility.map((indicator, idx) => (
                  <IndicatorCard key={idx} indicator={indicator} />
                ))}
              </div>
            </div>

            {/* Volume Indicators */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                Volume Indicators
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {indicators.volume.map((indicator, idx) => (
                  <IndicatorCard key={idx} indicator={indicator} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
