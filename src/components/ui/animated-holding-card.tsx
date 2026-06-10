"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Activity,
    Clock,
    DollarSign,
    LogOut,
    X,
    TrendingUp,
    ChevronDown,
    Loader2,
    MessageSquare,
    RefreshCw,
    CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useTheme } from "../ThemeProvider";

const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

interface AnimatedHoldingCardProps {
    holding: any;
    exitingId?: string | null;
    onExit?: (id: string, price: number) => void;
}

// Maps our condition indicator names to the live-indicators API field names
function resolveIndicatorValue(indicator: string, indicators: Record<string, number | null>): number | null {
    const key = indicator.toLowerCase()
    const map: Record<string, string[]> = {
        rsi: ['rsi'],
        macd: ['macd'],
        macd_signal: ['macdsignal', 'macdSignal'],
        macd_histogram: ['macdhistogram', 'macdHistogram'],
        adx: ['adx'],
        vwap: ['vwap'],
        cci: ['cci'],
        roc: ['roc'],
        supertrend: ['supertrend'],
        stoch_k: ['stochk', 'stochK'],
        stoch_d: ['stochd', 'stochD'],
        williams_r: ['williamsr', 'williamsR'],
        sma20: ['sma20'],
        sma50: ['sma50'],
        sma200: ['sma200'],
        ema12: ['ema12'],
        ema26: ['ema26'],
        atr: ['atr'],
        bb_upper: ['bbupper', 'bbUpper'],
        bb_lower: ['bblower', 'bbLower'],
        market_open: [],
    }
    const candidates = map[key] ?? [key]
    for (const c of candidates) {
        const val = indicators[c] ?? indicators[c.toLowerCase()]
        if (typeof val === 'number' && Number.isFinite(val)) return val
    }
    return null
}

export function AnimatedHoldingCard({ holding, exitingId, onExit }: AnimatedHoldingCardProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const prefersReducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

    const positive = holding.returns >= 0;
    const isExiting = exitingId === holding.id;
    const isPendingCondition = holding.status === 'CONDITION' || holding.status === 'CONDITION_NOT_MET';
    const isClosed = holding.status === 'CLOSED';
    const isLive = holding.status === 'LIVE';
    const [showExitPanel, setShowExitPanel] = useState(false);
    const [exitPriceType, setExitPriceType] = useState<'MARKET' | 'LIMIT'>('MARKET');
    const [exitLimitPrice, setExitLimitPrice] = useState<string>('');
    const [expandedSections, setExpandedSections] = useState<{ strategy: boolean }>({ strategy: false });
    const toggleSection = (section: 'strategy') => setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));

    // Live condition polling state
    const [liveConditions, setLiveConditions] = useState<any[]>(holding.conditions || []);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchLiveConditionValues = useCallback(async () => {
        if (!holding.symbol || !holding.conditions?.length) return;
        // Don't poll for MARKET_OPEN-only conditions or if no non-market conditions
        const hasRealIndicators = holding.conditions.some(
            (c: any) => c.indicator !== 'MARKET_OPEN'
        );
        if (!hasRealIndicators) return;

        setIsRefreshing(true);
        try {
            const res = await fetch(`/api/live-indicators?symbol=${encodeURIComponent(holding.symbol)}&timeframe=1d`, {
                cache: 'no-store',
            });
            if (!res.ok) return;
            const data = await res.json();
            const indicators: Record<string, number | null> = data?.data?.indicators ?? {};

            setLiveConditions(prev =>
                prev.map((c: any) => {
                    if (c.indicator === 'MARKET_OPEN') return c;
                    const liveVal = resolveIndicatorValue(c.indicator, indicators as any);
                    if (liveVal === null) return c;
                    const isMet = (() => {
                        switch (c.operator) {
                            case '>': return liveVal > c.threshold;
                            case '>=': return liveVal >= c.threshold;
                            case '<': return liveVal < c.threshold;
                            case '<=': return liveVal <= c.threshold;
                            case '=': return Math.abs(liveVal - c.threshold) < 0.001;
                            default: return false;
                        }
                    })();
                    return { ...c, currentValue: liveVal, isMet };
                })
            );
            setLastRefreshed(new Date());
        } catch {
            // non-fatal
        } finally {
            setIsRefreshing(false);
        }
    }, [holding.symbol, holding.conditions]);

    // Start polling only for pending conditional orders, stop when executed
    useEffect(() => {
        if (isPendingCondition && expandedSections.strategy) {
            fetchLiveConditionValues();
            pollIntervalRef.current = setInterval(fetchLiveConditionValues, 10000);
        }
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, [isPendingCondition, expandedSections.strategy, fetchLiveConditionValues]);

    // Sync from parent prop changes (e.g., after holdings refresh)
    useEffect(() => {
        setLiveConditions(holding.conditions || []);
    }, [holding.conditions]);

    const containerVariants: any = {
        hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.2, 0.65, 0.3, 0.9] } }
    };
    const listVariants: any = {
        hidden: { opacity: 0, height: 0, overflow: "hidden" },
        visible: { height: "auto", opacity: 1, overflow: "visible", transition: { duration: 0.25, staggerChildren: prefersReducedMotion ? 0 : 0.05, ease: [0.2, 0.65, 0.3, 0.9] } },
        exit: { height: 0, opacity: 0, overflow: "hidden", transition: { duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] } }
    };
    const itemVariants: any = {
        hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
        visible: { opacity: 1, x: 0, transition: { type: prefersReducedMotion ? "tween" : "spring", stiffness: 500, damping: 25 } }
    };

    const hasStrategy = holding.strategyParams?.length || holding.conditions?.length || holding.userPrompt || holding.targetProfitPct || holding.liveIndicators?.rsi !== undefined;
    const statValueClass = `${isDark ? 'text-white' : 'text-gray-900'}`;

    // The conditions to display — live-refreshed for pending, static for executed/closed
    const displayConditions = isPendingCondition ? liveConditions : (holding.conditions || []);

    return (
        <motion.div
            className={`w-full rounded-xl border shadow-sm overflow-hidden ${isDark ? 'bg-dark-400/80 border-white/10 shadow-black/20' : 'bg-white border-gray-200 shadow-gray-200/50'}`}
            initial="hidden"
            animate="visible"
            variants={containerVariants}
        >
            <LayoutGroup>
                {/* Header Section */}
                <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-white/10 bg-dark-300/50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex flex-col">
                        <span className={`font-semibold text-lg tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>{holding.symbol}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${holding.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                                {holding.action}
                            </span>
                            <span className={`text-[11px] font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{holding.quantity} shares</span>
                            {!isPendingCondition && (
                                <>
                                    <span className={`text-[11px] font-medium mx-1 ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>•</span>
                                    <span className={`text-[11px] font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Avg ₹{formatCurrency(holding.avgPrice)}</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {isLive ? (
                            <>
                                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                                    <Activity className="w-3.5 h-3.5" /> LIVE
                                </span>
                                <button
                                    onClick={() => {
                                        setExitLimitPrice(holding.marketPrice > 0 ? holding.marketPrice.toFixed(2) : '');
                                        setExitPriceType('MARKET');
                                        setShowExitPanel(p => !p);
                                    }}
                                    disabled={isExiting}
                                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${isDark ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'} disabled:opacity-50`}
                                >
                                    {isExiting ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                                    {isExiting ? 'Exiting…' : 'Exit'}
                                </button>
                            </>
                        ) : isPendingCondition ? (
                            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${isDark ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                <Clock className="w-3.5 h-3.5" /> CONDITIONAL
                            </span>
                        ) : (
                            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${isDark ? 'bg-gray-500/10 text-gray-400 border border-white/10' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                                CLOSED
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Exit Panel ─────────────────────────────────────── */}
                <AnimatePresence initial={false}>
                    {showExitPanel && isLive && (
                        <motion.div
                            key="exit-panel"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1, transition: { duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] } }}
                            exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: [0.2, 0.65, 0.3, 0.9] } }}
                            className="overflow-hidden"
                        >
                            <div className={`px-4 py-4 border-b ${isDark ? 'bg-dark-300/40 border-white/10' : 'bg-gray-50 border-gray-100'}`}>
                                {/* Panel header */}
                                <div className="flex items-center justify-between mb-3">
                                    <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Exit — {holding.symbol}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowExitPanel(false)}
                                        className={`p-1 rounded-md transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-white/10' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Qty & avg info row */}
                                <div className={`flex items-center justify-between text-xs mb-3 px-3 py-2 rounded-lg ${isDark ? 'bg-dark-400/60 text-gray-400' : 'bg-white text-gray-500 border border-gray-100'}`}>
                                    <span>{holding.quantity} shares · Avg&nbsp;₹{formatCurrency(holding.avgPrice)}</span>
                                    <span className={`font-medium ${holding.returns >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {holding.returns >= 0 ? '+' : ''}₹{formatCurrency(holding.returns)}
                                    </span>
                                </div>

                                {/* Market / Limit tabs */}
                                <div className={`flex rounded-lg overflow-hidden mb-3 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                                    {(['MARKET', 'LIMIT'] as const).map(pt => (
                                        <button
                                            key={pt}
                                            type="button"
                                            onClick={() => setExitPriceType(pt)}
                                            className={`flex-1 py-2 text-xs font-semibold transition-all ${exitPriceType === pt
                                                ? (isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600')
                                                : (isDark ? 'bg-transparent text-gray-500 hover:text-gray-300' : 'bg-transparent text-gray-400 hover:text-gray-600')
                                            }`}
                                        >
                                            {pt}
                                        </button>
                                    ))}
                                </div>

                                {/* Price input */}
                                <div className="mb-3">
                                    <label className={`text-[10px] uppercase tracking-wider font-semibold block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                        {exitPriceType === 'MARKET' ? 'Price (at market)' : 'Limit Price (₹)'}
                                    </label>
                                    <div className="relative">
                                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>₹</span>
                                        <input
                                            type="number"
                                            step="0.05"
                                            min="0"
                                            value={exitPriceType === 'MARKET' ? holding.marketPrice.toFixed(2) : exitLimitPrice}
                                            onChange={e => {
                                                if (exitPriceType === 'LIMIT') setExitLimitPrice(e.target.value);
                                            }}
                                            readOnly={exitPriceType === 'MARKET'}
                                            className={`w-full pl-7 pr-3 py-2.5 rounded-lg text-sm font-mono border outline-none transition-colors
                                                ${exitPriceType === 'MARKET'
                                                    ? (isDark ? 'bg-dark-400/40 border-white/5 text-gray-400 cursor-not-allowed' : 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed')
                                                    : (isDark ? 'bg-dark-400/60 border-white/10 text-white focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30' : 'bg-white border-gray-300 text-gray-900 focus:border-red-400 focus:ring-1 focus:ring-red-200')
                                                }`}
                                        />
                                    </div>
                                    {exitPriceType === 'MARKET' && (
                                        <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                                            Order will execute at best available market price
                                        </p>
                                    )}
                                </div>

                                {/* Estimated exit value */}
                                {(() => {
                                    const price = exitPriceType === 'MARKET'
                                        ? holding.marketPrice
                                        : parseFloat(exitLimitPrice) || 0;
                                    const value = price * holding.quantity;
                                    const pnl = (price - holding.avgPrice) * holding.quantity * (holding.action === 'BUY' ? 1 : -1);
                                    return value > 0 ? (
                                        <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg mb-3 ${isDark ? 'bg-dark-400/40 border border-white/5' : 'bg-white border border-gray-100'}`}>
                                            <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Est. exit value</span>
                                            <div className="text-right">
                                                <span className={`font-semibold font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                                    ₹{formatCurrency(value)}
                                                </span>
                                                <span className={`ml-2 font-medium ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {pnl >= 0 ? '+' : ''}₹{formatCurrency(pnl)}
                                                </span>
                                            </div>
                                        </div>
                                    ) : null;
                                })()}

                                {/* Confirm button */}
                                <button
                                    type="button"
                                    disabled={isExiting || (exitPriceType === 'LIMIT' && !(parseFloat(exitLimitPrice) > 0))}
                                    onClick={() => {
                                        const price = exitPriceType === 'MARKET'
                                            ? holding.marketPrice
                                            : parseFloat(exitLimitPrice);
                                        if (price > 0) {
                                            onExit?.(holding.id, price);
                                            setShowExitPanel(false);
                                        }
                                    }}
                                    className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all
                                        ${isDark
                                            ? 'bg-red-500/80 hover:bg-red-500 text-white disabled:opacity-40'
                                            : 'bg-red-500 hover:bg-red-600 text-white disabled:opacity-40'
                                        } disabled:cursor-not-allowed`}
                                >
                                    {isExiting
                                        ? 'Exiting…'
                                        : `Confirm Exit · ${holding.quantity} shares`}
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="p-4 space-y-4">
                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className={`rounded-xl p-3 border flex flex-col items-start ${isDark ? 'bg-dark-300/30 border-white/5' : 'bg-gray-50/50 border-gray-100'}`}>
                            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{isPendingCondition ? 'Status' : 'Market Price'}</p>
                            <p className={`text-lg font-bold ${statValueClass}`}>{isPendingCondition ? 'Pending' : `₹${formatCurrency(holding.marketPrice)}`}</p>
                            <p className={`text-[9px] mt-0.5 uppercase tracking-wide ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>{isPendingCondition ? 'Waiting for trigger' : holding.priceSource}</p>
                        </div>
                        <div className={`rounded-xl p-3 border flex flex-col items-start ${isDark ? 'bg-dark-300/30 border-white/5' : 'bg-gray-50/50 border-gray-100'}`}>
                            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Returns</p>
                            <p className={`text-lg font-bold ${isPendingCondition ? statValueClass : positive ? 'text-emerald-500' : 'text-red-500'}`}>{isPendingCondition ? '--' : `₹${positive ? '+' : ''}${formatCurrency(holding.returns)}`}</p>
                            {!isPendingCondition && holding.avgPrice > 0 && holding.marketPrice > 0 && (() => {
                                const pct = holding.action === 'BUY'
                                    ? ((holding.marketPrice / holding.avgPrice) - 1) * 100
                                    : ((holding.avgPrice / holding.marketPrice) - 1) * 100
                                return (
                                    <p className={`text-[11px] font-medium mt-0.5 ${pct >= 0 ? (isDark ? 'text-emerald-400/80' : 'text-emerald-600') : (isDark ? 'text-red-400/80' : 'text-red-600')}`}>
                                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                    </p>
                                )
                            })()}
                        </div>
                        <div className={`rounded-xl p-3 border flex flex-col items-start ${isDark ? 'bg-dark-300/30 border-white/5' : 'bg-gray-50/50 border-gray-100'}`}>
                            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{isPendingCondition ? 'Execution' : 'Invested'}</p>
                            <p className={`text-lg font-bold ${statValueClass}`}>{isPendingCondition ? 'Not Executed' : `₹${formatCurrency(holding.investedAmount)}`}</p>
                            <div className="flex items-center gap-1 mt-1">
                                <DollarSign className={`w-3 h-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                            </div>
                        </div>
                        <div className={`rounded-xl p-3 border flex flex-col items-start ${isDark ? 'bg-dark-300/30 border-white/5' : 'bg-gray-50/50 border-gray-100'}`}>
                            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Updated</p>
                            <p className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                {new Date(holding.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <div className="flex items-center gap-1 mt-1">
                                <Clock className={`w-3 h-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                            </div>
                        </div>
                    </div>

                    {/* Profit target progress bar — visible without expanding accordion */}
                    {isLive && typeof holding.targetProfitPct === 'number' && holding.avgPrice > 0 && holding.marketPrice > 0 && (() => {
                        const currentPct = holding.action === 'BUY'
                            ? ((holding.marketPrice / holding.avgPrice) - 1) * 100
                            : ((holding.avgPrice / holding.marketPrice) - 1) * 100
                        const target = holding.targetProfitPct
                        const progress = Math.min(Math.max((currentPct / target) * 100, 0), 100)
                        const targetPrice = holding.action === 'BUY'
                            ? holding.avgPrice * (1 + target / 100)
                            : holding.avgPrice * (1 - target / 100)
                        const reached = currentPct >= target
                        return (
                            <div className={`rounded-xl border px-4 py-3 ${isDark ? 'bg-dark-300/30 border-white/10' : 'bg-gray-50/50 border-gray-200'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-1.5">
                                        <TrendingUp className={`w-3.5 h-3.5 ${reached ? 'text-emerald-500' : isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Auto-exit target</span>
                                        {reached && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/20">REACHED</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] font-mono">
                                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                                            {currentPct >= 0 ? '+' : ''}{currentPct.toFixed(2)}%
                                        </span>
                                        <span className={isDark ? 'text-gray-600' : 'text-gray-300'}>/</span>
                                        <span className={`font-bold ${reached ? 'text-emerald-500' : isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                                            +{target.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                                <div className={`w-full h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${reached ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <p className={`text-[10px] mt-1.5 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                                    Target ₹{formatCurrency(targetPrice)} · Auto-exit fires when tab is open
                                </p>
                            </div>
                        )
                    })()}

                    {/* Collapsible Strategy Section */}
                    {hasStrategy && (
                        <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                            <motion.button
                                className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${isDark ? 'hover:bg-white/5 bg-dark-300/20' : 'hover:bg-gray-50 bg-gray-50/30'}`}
                                onClick={() => toggleSection('strategy')}
                                whileHover={{ backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)" }}
                            >
                                <div className="flex items-center gap-2">
                                    <TrendingUp className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                                    <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>Trading Strategy & Indicators</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isPendingCondition && expandedSections.strategy && (
                                        <div className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${isDark ? 'text-blue-400 bg-blue-500/10' : 'text-blue-600 bg-blue-50'}`}>
                                            <RefreshCw className={`w-2.5 h-2.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                            {lastRefreshed ? lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Live'}
                                        </div>
                                    )}
                                    <motion.div animate={{ rotate: expandedSections.strategy ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                        <ChevronDown className={`w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                    </motion.div>
                                </div>
                            </motion.button>

                            <AnimatePresence initial={false}>
                                {expandedSections.strategy && (
                                    <motion.div
                                        variants={listVariants}
                                        initial="hidden"
                                        animate="visible"
                                        exit="exit"
                                        className={`px-4 pb-4 pt-1 ${isDark ? 'bg-dark-300/10' : 'bg-white'}`}
                                    >
                                        <div className="space-y-4 mt-2">
                                            {/* Original User Prompt */}
                                            {holding.userPrompt && (
                                                <motion.div variants={itemVariants}>
                                                    <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Your Instruction</p>
                                                    <div className={`flex items-start gap-2 p-3 rounded-lg border ${isDark ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
                                                        <MessageSquare className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
                                                        <span className={`text-xs leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                            {holding.userPrompt}
                                                        </span>
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* Execution confirmation for trades that came from conditional */}
                                            {isLive && holding.userPrompt && holding.conditions?.length > 0 && (
                                                <motion.div variants={itemVariants}>
                                                    <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium ${isDark ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                                                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                                                        Trade executed — all conditions were met
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* Strategy Params */}
                                            {holding.strategyParams && holding.strategyParams.length > 0 && (
                                                <motion.div variants={itemVariants}>
                                                    <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Parameters</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {holding.strategyParams.map((param: any) => (
                                                            <span key={param.key} className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium ${isDark ? 'border-white/10 bg-white/5 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                                                                <span className="opacity-60">{param.label}:</span> {param.value}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* Targets & Progress */}
                                            {(holding.targetProfitPct || holding.targetPrice || holding.targetProgressPct !== undefined || holding.liveIndicators?.rsi !== undefined) && (
                                                <motion.div variants={itemVariants}>
                                                    <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Targets & Progress</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {typeof holding.liveIndicators?.rsi === 'number' && (
                                                            <div className={`p-2 px-3 rounded-lg border flex flex-col ${isDark ? 'bg-dark-400/50 border-white/5 shadow-inner' : 'bg-gray-50 border-gray-200 shadow-sm'}`}>
                                                                <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>RSI</span>
                                                                <span className={`text-sm font-mono font-bold mt-0.5 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{holding.liveIndicators.rsi.toFixed(2)}</span>
                                                            </div>
                                                        )}
                                                        {typeof holding.targetProfitPct === 'number' && (
                                                            <div className={`p-2 px-3 rounded-lg border flex flex-col ${isDark ? 'bg-dark-400/50 border-white/5 shadow-inner' : 'bg-gray-50 border-gray-200 shadow-sm'}`}>
                                                                <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Target %</span>
                                                                <span className={`text-sm font-mono font-bold mt-0.5 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{holding.targetProfitPct.toFixed(2)}%</span>
                                                            </div>
                                                        )}
                                                        {typeof holding.targetPrice === 'number' && (
                                                            <div className={`p-2 px-3 rounded-lg border flex flex-col ${isDark ? 'bg-dark-400/50 border-white/5 shadow-inner' : 'bg-gray-50 border-gray-200 shadow-sm'}`}>
                                                                <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Target Price</span>
                                                                <span className={`text-sm font-mono font-bold mt-0.5 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>₹{formatCurrency(holding.targetPrice)}</span>
                                                            </div>
                                                        )}
                                                        {typeof holding.targetProgressPct === 'number' && (
                                                            <div className={`p-2 px-3 rounded-lg border flex flex-col ${isDark ? 'bg-dark-400/50 border-white/5 shadow-inner' : 'bg-gray-50 border-gray-200 shadow-sm'}`}>
                                                                <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Progress</span>
                                                                <span className={`text-sm font-mono font-bold mt-0.5 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{Math.max(0, holding.targetProgressPct).toFixed(1)}%</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* Conditions — live-refreshed for pending, static for executed */}
                                            {displayConditions.length > 0 && (
                                                <motion.div variants={itemVariants}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <p className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                                                            {isPendingCondition ? 'Trigger Conditions (Live)' : 'Execution Conditions'}
                                                        </p>
                                                        {isPendingCondition && (
                                                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${isDark ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                                                                Refreshes every 10s
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        {displayConditions.map((condition: any, idx: number) => (
                                                            <div
                                                                key={`${condition.indicator}-${idx}`}
                                                                className={`p-2.5 rounded-lg border text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 transition-colors ${
                                                                    condition.isMet
                                                                        ? (isDark ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200')
                                                                        : (isDark ? 'bg-amber-500/10 border-amber-500/20' : 'bg-amber-50 border-amber-200')
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${condition.isMet ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                                                    <span className={`font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                                                                        {condition.indicator} {condition.operator} {condition.threshold}
                                                                    </span>
                                                                </div>
                                                                {typeof condition.currentValue === 'number' && (
                                                                    <div className={`flex items-center gap-1.5 text-xs font-medium font-mono px-2 py-1 rounded border ${
                                                                        isDark ? 'border-white/10 text-gray-300 bg-white/5' : 'border-gray-200 text-gray-600 bg-white'
                                                                    }`}>
                                                                        {isPendingCondition && (
                                                                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${condition.isMet ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                                                        )}
                                                                        Current: {condition.currentValue.toFixed(2)}
                                                                        {condition.isMet && isPendingCondition && (
                                                                            <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-0.5" />
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </LayoutGroup>
        </motion.div>
    );
}
