'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import Loader from './Loader'

interface StockChartProps {
  symbol: string
}

interface ChartPoint {
  time: UTCTimestamp
  price: number
  open: number
  high: number
  low: number
  close: number
  fullDate: string
}

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function formatFullDate(date: Date) {
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  const displayHours = hours % 12 || 12
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return `${date.getDate().toString().padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}, ${displayHours
    .toString()
    .padStart(2, '0')}:${minutes} ${ampm}`
}

function formatAxisLabel(time: Time, timeframe: string) {
  const timestamp = typeof time === 'number' ? time : null
  if (timestamp == null) {
    return ''
  }

  const date = new Date(Number(timestamp) * 1000)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  if (timeframe === '1d') {
    return `${hours}:${minutes}`
  }

  if (timeframe === '1w') {
    return `${weekdays[date.getDay()]} ${date.getDate()}`
  }

  if (timeframe === '1m' || timeframe === '3m') {
    return `${date.getDate()} ${months[date.getMonth()]}`
  }

  return `${months[date.getMonth()]} ${date.getFullYear()}`
}

function findHoveredPoint(time: Time | undefined, pointMap: Map<UTCTimestamp, ChartPoint>) {
  if (typeof time !== 'number') {
    return null
  }

  return pointMap.get(time as UTCTimestamp) ?? null
}

function setTooltipContent(tooltip: HTMLDivElement, point: ChartPoint | null) {
  if (!point) {
    tooltip.style.opacity = '0'
    return
  }

  tooltip.style.opacity = '1'
  tooltip.innerHTML = `
    <div class="text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-700/70 leading-none">Price</div>
    <div class="mt-1 text-[16px] font-semibold leading-none text-slate-900">${formatCurrency(point.price)}</div>
    <div class="mt-1.5 text-[10px] leading-none text-slate-500">${point.fullDate}</div>
  `
}

function positionTooltip(
  tooltip: HTMLDivElement,
  container: HTMLDivElement,
  x: number | undefined,
  y: number | undefined
) {
  const defaultLeft = 12
  const defaultTop = 8

  if (x == null || y == null) {
    tooltip.style.left = `${defaultLeft}px`
    tooltip.style.top = `${defaultTop}px`
    return
  }

  const tooltipWidth = tooltip.offsetWidth || 120
  const tooltipHeight = tooltip.offsetHeight || 56
  const horizontalPadding = 8

  let left = x - tooltipWidth / 2
  let top = 8

  if (left < horizontalPadding) {
    left = horizontalPadding
  }

  if (left + tooltipWidth > container.clientWidth - horizontalPadding) {
    left = container.clientWidth - tooltipWidth - horizontalPadding
  }

  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

export default function StockChart({ symbol }: StockChartProps) {
  const [timeframe, setTimeframe] = useState('1d')
  const [chartType, setChartType] = useState<'area' | 'candles'>('area')
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    void fetchChartData()
  }, [symbol, timeframe])

  useEffect(() => {
    const container = chartContainerRef.current
    const tooltip = tooltipRef.current

    if (!container || !tooltip || loading || error || chartData.length === 0) {
      chartRef.current?.remove()
      chartRef.current = null
      return
    }

    const pointMap = new Map(chartData.map((point) => [point.time, point]))
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'inherit',
      },
      localization: {
        priceFormatter: (value: number) => formatCurrency(value),
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          labelBackgroundColor: '#10b981',
          color: 'rgba(16, 185, 129, 0.35)',
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          labelBackgroundColor: '#10b981',
          color: 'rgba(16, 185, 129, 0.25)',
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
        scaleMargins: {
          top: 0.12,
          bottom: 0.18,
        },
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
        timeVisible: timeframe === '1d',
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => formatAxisLabel(time, timeframe),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    })

    if (chartType === 'candles') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#34d399',
        downColor: '#fb7185',
        borderVisible: false,
        wickUpColor: '#34d399',
        wickDownColor: '#fb7185',
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor: '#34d399',
      })

      candleSeries.setData(
        chartData.map((point) => ({
          time: point.time,
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
        }))
      )
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: '#34d399',
        topColor: 'rgba(52, 211, 153, 0.28)',
        bottomColor: 'rgba(52, 211, 153, 0.02)',
        lineWidth: 2,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBorderColor: '#d1fae5',
        crosshairMarkerBackgroundColor: '#10b981',
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor: '#34d399',
      })

      areaSeries.setData(chartData.map((point) => ({ time: point.time, value: point.price })))
    }

    chart.timeScale().fitContent()

    const latestPoint = chartData[chartData.length - 1] ?? null
    setTooltipContent(tooltip, latestPoint)
    positionTooltip(tooltip, container, undefined, undefined)

    chart.subscribeCrosshairMove((param) => {
      const hoveredPoint = findHoveredPoint(param.time, pointMap)
      const nextPoint = hoveredPoint ?? latestPoint

      setTooltipContent(tooltip, nextPoint)
      positionTooltip(tooltip, container, param.point?.x, param.point?.y)
    })

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      })
      chart.timeScale().fitContent()
    })

    resizeObserver.observe(container)
    chartRef.current = chart

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [chartData, chartType, error, loading, timeframe])

  const fetchChartData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/stocks/${symbol}/data?timeframe=${timeframe}`)
      const result = await response.json()

      if (!result.success || !result.data?.priceData) {
        setChartData([])
        setError(result.error || 'No data available')
        return
      }

      const formatted = result.data.priceData
        .map((item: { timestamp: string; open: number; high: number; low: number; close: number }) => {
          const date = new Date(item.timestamp)
          if (Number.isNaN(date.getTime())) {
            return null
          }

          return {
            time: Math.floor(date.getTime() / 1000) as UTCTimestamp,
            price: Number(item.close),
            open: Number(item.open),
            high: Number(item.high),
            low: Number(item.low),
            close: Number(item.close),
            fullDate: formatFullDate(date),
          }
        })
        .filter((item: ChartPoint | null): item is ChartPoint => item !== null)

      setChartData(formatted)

      if (formatted.length === 0) {
        setError('No data available for this timeframe')
      }
    } catch (fetchError) {
      console.error('Error fetching chart data:', fetchError)
      setChartData([])
      setError('Failed to load chart')
    } finally {
      setLoading(false)
    }
  }

  const timeframes = [
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
    { label: '1M', value: '1m' },
    { label: '3M', value: '3m' },
    { label: '6M', value: '6m' },
    { label: '1Y', value: '1y' },
  ]

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4 md:mb-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base md:text-lg font-semibold text-white">Price Chart</h3>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-dark-400/40 p-1">
            <button
              onClick={() => setChartType('area')}
              className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-lg transition-colors ${
                chartType === 'area' ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              Area
            </button>
            <button
              onClick={() => setChartType('candles')}
              className={`px-3 py-1.5 text-xs md:text-sm font-medium rounded-lg transition-colors ${
                chartType === 'candles' ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              Candles
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-2.5 md:px-3 py-1.5 text-xs md:text-sm font-medium rounded-xl transition-colors whitespace-nowrap flex-shrink-0 ${
                timeframe === tf.value
                  ? 'bg-emerald-500 text-white shadow-glow-green'
                  : 'bg-dark-400/50 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-64 md:h-80">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader size={40} />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 bg-dark-400/40 rounded-xl border border-white/5">
            {error}
          </div>
        ) : (
          <>
            <div ref={chartContainerRef} className="h-full w-full" />
            <div
              ref={tooltipRef}
              className="pointer-events-none absolute z-10 min-w-[96px] rounded-md border border-emerald-200/80 bg-white/95 px-2 py-1.5 shadow-md shadow-emerald-950/8 transition-opacity duration-150"
            />
          </>
        )}
      </div>
    </div>
  )
}
