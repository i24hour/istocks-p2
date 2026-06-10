"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "../ThemeProvider";

interface ThinkingStep {
    type: string;
    text: string;
    data?: any;
}

/** Remove leading emoji clusters from thinking-trace lines (backend still may send emoji). */
function stripThinkingEmojiPrefix(text: string): string {
    let result = text.trimStart()
    // Misc symbols / dingbats often used as emoji (e.g. ⚙️) plus Extended_Pictographic, optional VS / Fitzpatrick / ZWJ chains
    const chunk =
        /^([\u2692-\u27BF\u2B00-\u2BFF]|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E)?(?:\u200D([\u2692-\u27BF\u2B00-\u2BFF]|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E)?)*(?:[\u{1F3FB}-\u{1F3FF}])?\s*/u
    while (result.length > 0) {
        const m = result.match(chunk)
        if (!m) break
        result = result.slice(m[0].length)
    }
    return result
}

function thinkingStepPlain(text: string): string {
    const t = stripThinkingEmojiPrefix(text)
    return t.length > 0 ? t : text.trim()
}

export function AnimatedThinking({ steps, timer }: { steps: ThinkingStep[]; timer: number }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to latest step
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [steps.length]);

    const latestText = steps.length > 0
        ? thinkingStepPlain(steps[steps.length - 1].text)
        : `Thinking... (${timer.toFixed(1)}s)`;

    return (
        <motion.div
            className="w-full"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
        >
            {/* Latest step + timer */}
            <div className="pt-1 pb-1 flex items-center gap-2">
                <motion.div
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"
                />
                <span className={`text-xs font-medium truncate ${isDark ? 'text-gray-400' : 'text-[var(--text-muted)]'}`}>
                    {latestText}
                </span>
                <span className={`ml-auto text-[10px] flex-shrink-0 tabular-nums ${isDark ? 'text-gray-600' : 'text-[var(--text-muted)]'}`}>
                    {timer.toFixed(1)}s
                </span>
            </div>

            {/* Timeline of all steps */}
            {steps.length > 0 && (
                <div className="pb-1 pt-0.5 max-h-60 overflow-y-auto overflow-x-hidden">
                    <div className="relative space-y-0">
                        {/* Vertical line */}
                        <div className={`absolute left-[5px] top-2 bottom-2 w-px ${isDark ? 'bg-white/10' : 'bg-[var(--border-subtle)]'}`} />

                        <AnimatePresence initial={false}>
                            {steps.map((step, i) => {
                                const isLast = i === steps.length - 1;
                                return (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="flex items-start gap-3 pl-4 py-0.5 relative"
                                    >
                                        {/* Dot on timeline */}
                                        <div className={`absolute left-0 top-[7px] w-[11px] h-[11px] rounded-full border-2 flex-shrink-0 ${
                                            isLast
                                                ? isDark ? 'border-emerald-500 bg-dark-400' : 'border-emerald-500 bg-[var(--chat-composer-bg)]'
                                                : isDark ? 'border-white/20 bg-dark-400' : 'border-[var(--border-color)] bg-[var(--chat-canvas-bg)]'
                                        }`} />
                                        <p className={`text-[12px] leading-[1.5] ${
                                            isLast
                                                ? isDark ? 'text-gray-200' : 'text-[var(--text-primary)]'
                                                : isDark ? 'text-gray-500' : 'text-[var(--text-muted)]'
                                        }`}>
                                            {thinkingStepPlain(step.text)}
                                        </p>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                        <div ref={bottomRef} />
                    </div>
                </div>
            )}
        </motion.div>
    );
}
