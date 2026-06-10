"use client";

import React, { useState } from "react";
import {
    CheckCircle2,
    CircleDotDashed,
    XCircle,
    ShieldCheck,
    DollarSign,
    BarChart3,
    AlertTriangle,
    ChevronDown,
    Activity,
    Square,
    LogOut,
    TrendingUp,
    Target,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";

export function AnimatedTradeCard({
    plan,
    isConfirmed,
    isCancelled,
    onConfirm,
    onCancel,
    isActionable,
    isWatchingConditions,
    onStopWatching,
    workflowStatus,
    tradeSteps,
    tradeCard,
    onExit,
}: {
    plan: any;
    isConfirmed: boolean;
    isCancelled: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    isActionable: boolean;
    isWatchingConditions?: boolean;
    onStopWatching?: () => void;
    workflowStatus?: 'proposed' | 'watching' | 'processing' | 'executed' | 'cancelled' | 'failed';
    tradeSteps?: Array<{ label: string; detail?: string; status: 'pending' | 'completed' | 'failed' }>;
    tradeCard?: any;
    onExit?: () => void;
}) {
    const prefersReducedMotion =
        typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

    const [expandedSections, setExpandedSections] = useState<{ conditions: boolean; indicators: boolean }>({
        conditions: true,
        indicators: false,
    });

    const toggleSection = (section: "conditions" | "indicators") => {
        setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    };

    const containerVariants: any = {
        hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 10 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: [0.2, 0.65, 0.3, 0.9] },
        },
    };

    const listVariants: any = {
        hidden: { opacity: 0, height: 0, overflow: "hidden" },
        visible: {
            height: "auto",
            opacity: 1,
            overflow: "visible",
            transition: {
                duration: 0.25,
                staggerChildren: prefersReducedMotion ? 0 : 0.05,
                ease: [0.2, 0.65, 0.3, 0.9],
            },
        },
        exit: {
            height: 0,
            opacity: 0,
            overflow: "hidden",
            transition: { duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] },
        },
    };

    const itemVariants: any = {
        hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
        visible: {
            opacity: 1,
            x: 0,
            transition: {
                type: prefersReducedMotion ? "tween" : "spring",
                stiffness: 500,
                damping: 25,
            },
        },
    };

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

    const statusLabel =
        workflowStatus === "watching"
            ? "Watching"
            : workflowStatus === "processing"
              ? "Processing"
              : workflowStatus === "executed"
                ? "Executed"
                : workflowStatus === "cancelled"
                  ? "Cancelled"
                  : workflowStatus === "failed"
                    ? "Failed"
                    : "Proposed";

    const statusBadgeClass =
        workflowStatus === "watching"
            ? "bg-[var(--trade-warning-soft)] text-[var(--trade-warning)] border border-[var(--trade-warning)]/20"
            : workflowStatus === "processing"
              ? "bg-[var(--trade-accent-soft)] text-[var(--trade-accent)] border border-[var(--trade-accent-border)]"
              : workflowStatus === "executed"
                ? "bg-[var(--trade-success-soft)] text-[var(--trade-success)] border border-[var(--trade-accent-border)]"
                : workflowStatus === "cancelled" || workflowStatus === "failed"
                  ? "bg-[var(--trade-danger-soft)] text-[var(--trade-danger)] border border-[var(--trade-danger)]/20"
                  : "bg-[var(--trade-badge-neutral-bg)] text-[var(--trade-badge-neutral-text)] border border-[var(--trade-border)]";

    const statCellClass =
        "rounded-xl p-3.5 border bg-[var(--trade-muted-surface)] border-[var(--trade-border)]";
    const statLabelClass =
        "text-[10px] uppercase tracking-[0.08em] font-semibold mb-1.5 text-[var(--trade-label)]";

    const conditionCardClass = (isMet: boolean | undefined) =>
        cn(
            "rounded-xl border p-3 transition-colors",
            isMet === true && "bg-[var(--trade-success-soft)] border-[var(--trade-accent-border)]",
            isMet === false && "bg-[var(--trade-danger-soft)] border-[var(--trade-danger)]/25",
            isMet !== true && isMet !== false && "bg-[var(--trade-muted-surface)] border-[var(--trade-border)]",
        );

    const sectionBtnClass =
        "w-full px-4 py-3 flex items-center justify-between transition-colors bg-[var(--trade-muted-surface)] hover:bg-[var(--trade-border-subtle)]";

    return (
        <motion.div
            className="w-full rounded-2xl border overflow-hidden bg-[var(--trade-surface)] border-[var(--trade-border)] shadow-[var(--shadow-md)]"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
        >
            <LayoutGroup>
                <div className="px-4 py-3.5 border-b flex items-center justify-between border-[var(--trade-border)] bg-[var(--trade-surface)]">
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--trade-accent-soft)] border border-[var(--trade-accent-border)]">
                            <ShieldCheck className="w-4 h-4 text-[var(--trade-accent)]" />
                        </div>
                        <div>
                            <span className="font-semibold text-sm tracking-tight text-[var(--trade-text)]">
                                Trade Plan Review
                            </span>
                            <p className="text-[11px] text-[var(--trade-label)] mt-0.5">
                                Review details before execution
                            </p>
                        </div>
                    </div>
                    <span className={cn("text-[11px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide", statusBadgeClass)}>
                        {statusLabel}
                    </span>
                </div>

                <div className="p-4 space-y-4 bg-[var(--trade-surface)]">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className={statCellClass}>
                            <p className={statLabelClass}>Action</p>
                            <p
                                className={cn(
                                    "text-base font-bold tabular-nums",
                                    plan.action === "BUY" ? "text-[var(--trade-success)]" : "text-[var(--trade-danger)]",
                                )}
                            >
                                {plan.action}
                            </p>
                        </div>
                        <div className={statCellClass}>
                            <p className={statLabelClass}>Stock</p>
                            <p className="text-base font-bold text-[var(--trade-text)] tracking-tight">{plan.symbol}</p>
                        </div>
                        <div className={statCellClass}>
                            <p className={statLabelClass}>Quantity</p>
                            <p className="text-base font-bold text-[var(--trade-text)] tabular-nums">{plan.quantity}</p>
                        </div>
                        <div className={statCellClass}>
                            <p className={statLabelClass}>Live Price</p>
                            <p className="text-base font-bold text-[var(--trade-text)] tabular-nums">
                                {plan.currentPrice ? `₹${plan.currentPrice.toFixed(2)}` : "N/A"}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl p-4 border flex items-center justify-between bg-[var(--trade-surface)] border-[var(--trade-border)] border-l-[3px] border-l-[var(--trade-accent)]">
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--trade-muted-surface)] border border-[var(--trade-border)]">
                                <DollarSign className="w-3.5 h-3.5 text-[var(--trade-label)]" />
                            </div>
                            <span className="text-sm font-medium text-[var(--trade-text-secondary)]">Estimated Cost</span>
                        </div>
                        <span className="text-lg font-bold tracking-tight tabular-nums text-[var(--trade-text)]">
                            <span className="text-[var(--trade-accent)]">₹</span>
                            {plan.estimatedCost.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            })}
                        </span>
                    </div>

                    {/* ── Exit Strategy (profit target + stop loss) ── */}
                    {(typeof plan.targetProfitPct === "number" || plan.strategyParams?.some((p: any) => p.key === "stop-loss")) && (
                        <motion.div
                            variants={itemVariants}
                            className="rounded-xl border overflow-hidden border-[var(--trade-border)]"
                        >
                            <div className="px-4 py-2.5 flex items-center gap-2 bg-[var(--trade-muted-surface)] border-b border-[var(--trade-border)]">
                                <Target className="w-4 h-4 text-[var(--trade-success)]" />
                                <span className="text-sm font-semibold text-[var(--trade-text)]">Exit Strategy</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--trade-accent-border)] bg-[var(--trade-accent-soft)] text-[var(--trade-success)] font-semibold ml-auto">
                                    Auto-tracked
                                </span>
                            </div>
                            <div className="px-4 py-3 bg-[var(--trade-surface)] flex flex-wrap gap-3">
                                {typeof plan.targetProfitPct === "number" && (
                                    <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5 bg-[var(--trade-success-soft)] border-[var(--trade-accent-border)] flex-1 min-w-[140px]">
                                        <TrendingUp className="w-4 h-4 text-[var(--trade-success)] shrink-0" />
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--trade-label)] font-semibold">Take Profit</p>
                                            <p className="text-sm font-bold text-[var(--trade-success)] tabular-nums">+{plan.targetProfitPct}%</p>
                                            {plan.currentPrice && (
                                                <p className="text-[10px] text-[var(--trade-label)] font-mono tabular-nums">
                                                    ≈ ₹{(plan.action === "BUY"
                                                        ? plan.currentPrice * (1 + plan.targetProfitPct / 100)
                                                        : plan.currentPrice * (1 - plan.targetProfitPct / 100)
                                                    ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {plan.strategyParams?.filter((p: any) => p.key === "stop-loss").map((p: any) => {
                                    const slPct = parseFloat(p.value)
                                    return (
                                        <div key={p.key} className="flex items-center gap-2 rounded-xl border px-3 py-2.5 bg-[var(--trade-danger-soft)] border-[var(--trade-danger)]/25 flex-1 min-w-[140px]">
                                            <AlertTriangle className="w-4 h-4 text-[var(--trade-danger)] shrink-0" />
                                            <div>
                                                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--trade-label)] font-semibold">Stop Loss</p>
                                                <p className="text-sm font-bold text-[var(--trade-danger)] tabular-nums">-{slPct}%</p>
                                                {plan.currentPrice && (
                                                    <p className="text-[10px] text-[var(--trade-label)] font-mono tabular-nums">
                                                        ≈ ₹{(plan.action === "BUY"
                                                            ? plan.currentPrice * (1 - slPct / 100)
                                                            : plan.currentPrice * (1 + slPct / 100)
                                                        ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="px-4 py-2.5 bg-[var(--trade-muted-surface)] border-t border-[var(--trade-border)]">
                                <p className="text-[11px] text-[var(--trade-label)] leading-relaxed">
                                    Auto-exit fires when target is reached while this tab is open. Live P&amp;L is checked every 2s.
                                </p>
                            </div>
                        </motion.div>
                    )}

                    <div className="rounded-xl border overflow-hidden border-[var(--trade-border)]">
                        {plan.conditions && plan.conditions.length > 0 && (
                            <div className="border-b last:border-0 border-[var(--trade-border)]">
                                <motion.button
                                    type="button"
                                    className={sectionBtnClass}
                                    onClick={() => toggleSection("conditions")}
                                >
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4 text-[var(--trade-accent)]" />
                                        <span className="text-sm font-semibold text-[var(--trade-text)]">
                                            Trading Conditions
                                        </span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--trade-badge-neutral-bg)] text-[var(--trade-badge-neutral-text)] font-semibold">
                                            {plan.conditions.length}
                                        </span>
                                    </div>
                                    <motion.div
                                        animate={{ rotate: expandedSections.conditions ? 180 : 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <ChevronDown className="w-4 h-4 text-[var(--trade-label)]" />
                                    </motion.div>
                                </motion.button>

                                <AnimatePresence initial={false}>
                                    {expandedSections.conditions && (
                                        <motion.div
                                            variants={listVariants}
                                            initial="hidden"
                                            animate="visible"
                                            exit="exit"
                                            className="px-4 pb-3 pt-1 bg-[var(--trade-surface)]"
                                        >
                                            <ul className="space-y-2.5 relative mt-2">
                                                <div className="absolute left-[13px] top-4 bottom-4 w-px bg-[var(--trade-border)]" />

                                                {plan.conditions.map((c: any, i: number) => {
                                                    const isCross = !!c.thresholdIndicator;
                                                    const lhsVal =
                                                        typeof c.currentValue === "number"
                                                            ? c.currentValue.toFixed(2)
                                                            : null;
                                                    const rhsVal =
                                                        isCross &&
                                                        typeof c.threshold === "number" &&
                                                        c.threshold !== 0
                                                            ? c.threshold.toFixed(2)
                                                            : null;
                                                    const tfLabel =
                                                        plan.indicatorTimeframe === "1d"
                                                            ? "1D"
                                                            : plan.indicatorTimeframe === "1w"
                                                              ? "1W"
                                                              : plan.indicatorTimeframe === "1h"
                                                                ? "1H"
                                                                : (plan.indicatorTimeframe || "1m").replace(
                                                                      /m$/,
                                                                      "min",
                                                                  );

                                                    const valueTone =
                                                        c.isMet === true
                                                            ? "text-[var(--trade-success)]"
                                                            : c.isMet === false
                                                              ? "text-[var(--trade-danger)]"
                                                              : "text-[var(--trade-text-secondary)]";

                                                    return (
                                                        <motion.li key={i} variants={itemVariants} className="relative z-10 pl-8">
                                                            <div className="absolute left-0 top-2 w-7 flex justify-center">
                                                                <motion.div
                                                                    initial={{ scale: 0.8 }}
                                                                    animate={{ scale: 1 }}
                                                                    transition={{
                                                                        type: "spring",
                                                                        stiffness: 400,
                                                                        damping: 20,
                                                                    }}
                                                                >
                                                                    {c.isMet === true ? (
                                                                        <CheckCircle2 className="w-[18px] h-[18px] rounded-full bg-[var(--trade-surface)] text-[var(--trade-success)]" />
                                                                    ) : c.isMet === false ? (
                                                                        <XCircle className="w-[18px] h-[18px] rounded-full bg-[var(--trade-surface)] text-[var(--trade-danger)]" />
                                                                    ) : (
                                                                        <CircleDotDashed className="w-[18px] h-[18px] rounded-full bg-[var(--trade-surface)] text-[var(--trade-label)]" />
                                                                    )}
                                                                </motion.div>
                                                            </div>

                                                            <div className={conditionCardClass(c.isMet)}>
                                                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="text-sm font-semibold tracking-tight text-[var(--trade-text)]">
                                                                            {c.indicator} {c.operator}{" "}
                                                                            {c.thresholdIndicator ?? c.threshold}
                                                                        </span>
                                                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-[var(--trade-border)] bg-[var(--trade-muted-surface)] text-[var(--trade-label)]">
                                                                            {tfLabel}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-2 pt-1">
                                                                    {isCross ? (
                                                                        <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-[var(--trade-text-secondary)]">
                                                                            <span className={valueTone}>
                                                                                {c.indicator}: {lhsVal ?? "—"}
                                                                            </span>
                                                                            <span className="text-[var(--trade-label)]">
                                                                                {c.operator}
                                                                            </span>
                                                                            <span className={valueTone}>
                                                                                {c.thresholdIndicator}: {rhsVal ?? "—"}
                                                                            </span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--trade-text-secondary)]">
                                                                            <span>
                                                                                Current:{" "}
                                                                                <span className={cn("font-mono font-bold tabular-nums", valueTone)}>
                                                                                    {lhsVal ?? "—"}
                                                                                </span>
                                                                            </span>
                                                                            <span className="text-[var(--trade-label)]">
                                                                                (target {c.operator} {c.threshold})
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </motion.li>
                                                    );
                                                })}
                                            </ul>

                                            {!plan.conditionsPassed && (
                                                <motion.div
                                                    variants={itemVariants}
                                                    className="mt-3 ml-8 p-3 rounded-xl border text-xs flex gap-2.5 bg-[var(--trade-warning-soft)] border-[var(--trade-warning)]/20 text-[var(--trade-text-secondary)]"
                                                >
                                                    <AlertTriangle className="w-4 h-4 flex-shrink-0 text-[var(--trade-warning)]" />
                                                    <p>
                                                        Conditions not currently met. Click{" "}
                                                        <span className="font-semibold text-[var(--trade-text)]">
                                                            Watch & Execute
                                                        </span>{" "}
                                                        to monitor.
                                                    </p>
                                                </motion.div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        {plan.liveIndicators && Object.keys(plan.liveIndicators).length > 0 && (
                            <div className="border-b last:border-0 border-[var(--trade-border)]">
                                <motion.button
                                    type="button"
                                    className={sectionBtnClass}
                                    onClick={() => toggleSection("indicators")}
                                >
                                    <div className="flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-[var(--trade-accent)]" />
                                        <span className="text-sm font-semibold text-[var(--trade-text)]">
                                            Live Indicator Data
                                        </span>
                                    </div>
                                    <motion.div
                                        animate={{ rotate: expandedSections.indicators ? 180 : 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <ChevronDown className="w-4 h-4 text-[var(--trade-label)]" />
                                    </motion.div>
                                </motion.button>

                                <AnimatePresence initial={false}>
                                    {expandedSections.indicators && (
                                        <motion.div
                                            variants={listVariants}
                                            initial="hidden"
                                            animate="visible"
                                            exit="exit"
                                            className="px-4 pb-4 pt-1 bg-[var(--trade-surface)]"
                                        >
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {Object.entries(plan.liveIndicators).map(([key, val]: [string, any]) => (
                                                    <motion.div
                                                        key={key}
                                                        variants={itemVariants}
                                                        className="p-2.5 rounded-xl border flex flex-col items-start min-w-[3.5rem] w-fit bg-[var(--trade-muted-surface)] border-[var(--trade-border)]"
                                                    >
                                                        <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--trade-label)]">
                                                            {key}
                                                        </span>
                                                        <span className="text-sm font-mono font-bold mt-0.5 tabular-nums text-[var(--trade-text)]">
                                                            {typeof val === "number"
                                                                ? val.toFixed(key === "rsi" ? 1 : 2)
                                                                : val}
                                                        </span>
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                    {isActionable && (
                        <motion.div className="flex gap-2.5 pt-1" variants={itemVariants}>
                            <button
                                type="button"
                                onClick={onCancel}
                                className="flex-1 py-3 rounded-xl border text-sm font-semibold transition-all flex justify-center items-center gap-2 border-[var(--trade-border)] bg-[var(--trade-surface)] text-[var(--trade-text-secondary)] hover:bg-[var(--trade-muted-surface)] hover:text-[var(--trade-text)]"
                            >
                                <XCircle className="w-4 h-4" /> Cancel
                            </button>
                            <button
                                type="button"
                                onClick={onConfirm}
                                className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-all flex justify-center items-center gap-2 bg-[var(--trade-accent)] hover:bg-[var(--trade-accent-hover)] shadow-[var(--shadow-sm)]"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                {plan.conditionsPassed ? "Execute Trade" : "Watch & Execute"}
                            </button>
                        </motion.div>
                    )}

                    {tradeSteps && tradeSteps.length > 0 && (
                        <motion.div
                            variants={itemVariants}
                            className="rounded-xl border overflow-hidden bg-[var(--trade-surface)] border-[var(--trade-border)]"
                        >
                            <div className="px-4 py-3 flex items-center gap-2 border-b border-[var(--trade-border)] bg-[var(--trade-muted-surface)]">
                                <Activity className="w-4 h-4 text-[var(--trade-accent)]" />
                                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--trade-text)]">
                                    Trade Progress
                                </span>
                            </div>
                            <div className="px-4 py-2">
                                {tradeSteps.map((step, index) => (
                                    <div
                                        key={`${step.label}-${index}`}
                                        className={cn(
                                            "flex items-start gap-3 py-2.5",
                                            index < tradeSteps.length - 1 && "border-b border-[var(--trade-border-subtle)]",
                                        )}
                                    >
                                        <div className="mt-0.5 flex-shrink-0">
                                            {step.status === "completed" && (
                                                <CheckCircle2 className="w-[18px] h-[18px] text-[var(--trade-success)]" />
                                            )}
                                            {step.status === "pending" && (
                                                <CircleDotDashed className="w-[18px] h-[18px] text-[var(--trade-warning)] animate-spin" />
                                            )}
                                            {step.status === "failed" && (
                                                <AlertTriangle className="w-[18px] h-[18px] text-[var(--trade-danger)]" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-[var(--trade-text)]">{step.label}</p>
                                            {step.detail && (
                                                <p className="text-xs mt-0.5 text-[var(--trade-label)] leading-relaxed">{step.detail}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {tradeCard && (
                        <motion.div
                            variants={itemVariants}
                            className="rounded-xl border p-4 space-y-3 bg-[var(--trade-surface)] border-[var(--trade-border)]"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-[var(--trade-text)]">
                                        {tradeCard.symbol} • {tradeCard.action} {tradeCard.quantity} shares
                                    </p>
                                    <p className="text-xs text-[var(--trade-label)] tabular-nums">
                                        Average Price: ₹{formatCurrency(tradeCard.avgPrice)}
                                    </p>
                                </div>
                                {tradeCard.isLive ? (
                                    <button
                                        onClick={onExit}
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors border-[var(--trade-danger)]/25 bg-[var(--trade-danger-soft)] text-[var(--trade-danger)] hover:opacity-90"
                                    >
                                        <LogOut className="w-3 h-3" /> Exit
                                    </button>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-[var(--trade-border)] bg-[var(--trade-muted-surface)] text-[var(--trade-label)]">
                                        CLOSED
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                    { label: "Market Price", value: `₹${formatCurrency(tradeCard.marketPrice)}`, tone: "text-[var(--trade-text)]" },
                                    {
                                        label: "Returns",
                                        value: `${tradeCard.returns >= 0 ? "+" : "-"}₹${formatCurrency(Math.abs(tradeCard.returns))}`,
                                        tone: tradeCard.returns >= 0 ? "text-[var(--trade-success)]" : "text-[var(--trade-danger)]",
                                    },
                                    { label: "Invested", value: `₹${formatCurrency(tradeCard.investedAmount)}`, tone: "text-[var(--trade-text)]" },
                                    {
                                        label: "Status",
                                        value: tradeCard.isLive ? "LIVE" : "Closed",
                                        tone: tradeCard.isLive ? "text-[var(--trade-success)]" : "text-[var(--trade-text-secondary)]",
                                    },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        className="rounded-xl border p-2.5 bg-[var(--trade-muted-surface)] border-[var(--trade-border)]"
                                    >
                                        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--trade-label)]">
                                            {item.label}
                                        </p>
                                        <p className={cn("text-sm font-semibold tabular-nums mt-0.5", item.tone)}>{item.value}</p>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {isWatchingConditions && isConfirmed && (
                        <motion.div
                            variants={itemVariants}
                            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1"
                        >
                            <div className="flex-1 flex flex-col gap-0.5 px-4 py-3 rounded-xl border bg-[var(--trade-warning-soft)] border-[var(--trade-warning)]/20">
                                <div className="flex items-center gap-2 text-[var(--trade-warning)]">
                                    <CircleDotDashed className="w-4 h-4 animate-spin flex-shrink-0" />
                                    <span className="text-sm font-medium text-[var(--trade-text-secondary)]">
                                        Watching conditions... Auto-executes when met.
                                    </span>
                                </div>
                                {typeof plan.targetProfitPct === "number" && (
                                    <p className="text-[11px] text-[var(--trade-label)] pl-6">
                                        After entry: auto-exits at <span className="text-[var(--trade-success)] font-semibold">+{plan.targetProfitPct}% profit</span>
                                        {plan.currentPrice ? ` (≈ ₹${(plan.action === "BUY" ? plan.currentPrice * (1 + plan.targetProfitPct / 100) : plan.currentPrice * (1 - plan.targetProfitPct / 100)).toLocaleString("en-IN", { maximumFractionDigits: 2 })})` : ""}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={onStopWatching}
                                type="button"
                                className="px-6 py-3 rounded-xl border transition-all text-sm font-semibold flex justify-center items-center gap-2 border-[var(--trade-danger)]/25 bg-[var(--trade-danger-soft)] text-[var(--trade-danger)] hover:opacity-90"
                            >
                                <Square className="w-4 h-4" /> Stop
                            </button>
                        </motion.div>
                    )}
                </div>
            </LayoutGroup>
        </motion.div>
    );
}
