"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/ThemeProvider"

interface NavItem {
    name: string
    url: string
    icon: LucideIcon
    badge?: string
}

interface NavBarProps {
    items: NavItem[]
    className?: string
}

export function NavBar({ items, className }: NavBarProps) {
    const pathname = usePathname()
    const [activeTab, setActiveTab] = useState(() => {
        const current = items.find((item) => item.url === pathname)
        return current ? current.name : items[0].name
    })
    const { theme } = useTheme()
    const isDark = theme === "dark"
    const isClaude = theme === "claude-code"

    useEffect(() => {
        const current = items.find((item) => item.url === pathname)
        if (current) {
            setActiveTab(current.name)
        }
    }, [pathname, items])

    return (
        <div className={cn("hidden lg:flex min-w-0 max-w-full flex-1 justify-center overflow-hidden", className)}>
            <div
                className={cn(
                    "flex w-full min-w-0 max-w-full flex-nowrap items-center justify-between gap-0 py-1 px-2 sm:px-2.5 rounded-full border shadow-lg supports-[backdrop-filter]:backdrop-blur-md transition-colors overflow-x-auto overscroll-x-contain scrollbar-hide",
                    isDark ? "bg-black/20 border-white/10" : "bg-black/5 border-black/5"
                )}
            >
                {items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.name

                    return (
                        <Link
                            key={item.name}
                            href={item.url}
                            onClick={() => setActiveTab(item.name)}
                            className={cn(
                                "relative isolate flex shrink-0 items-center justify-center px-2 sm:px-2.5 py-2 text-center text-sm font-semibold transition-colors whitespace-nowrap",
                                isDark
                                    ? isActive
                                        ? "text-emerald-400"
                                        : "text-gray-400 hover:text-emerald-300"
                                    : isClaude
                                      ? isActive
                                          ? "text-[#b4532a]"
                                          : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                                      : isActive
                                        ? "text-emerald-700"
                                        : "text-gray-600 hover:text-emerald-600",
                                isActive && (isDark ? "" : "")
                            )}
                        >
                            {/* Compact tubelight — no large blur so neighbors are not washed out */}
                            {isActive && (
                                <span
                                    className={cn(
                                        "pointer-events-none absolute top-1 left-1/2 z-10 h-1 w-7 -translate-x-1/2 rounded-full",
                                        isDark
                                            ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]"
                                            : isClaude
                                              ? "bg-[var(--accent)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_40%,transparent)]"
                                              : "bg-emerald-600 shadow-[0_0_8px_rgba(5,150,105,0.35)]"
                                    )}
                                    aria-hidden
                                />
                            )}
                            <span className="hidden md:inline-flex items-center gap-1.5 whitespace-nowrap pt-2">
                                {item.name}
                                {item.badge && (
                                    <span className="text-[9px] bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-1.5 py-0.5 rounded-full font-bold tracking-wider">
                                        {item.badge}
                                    </span>
                                )}
                            </span>
                            <span className="md:hidden inline-flex pt-2">
                                <Icon size={18} strokeWidth={2.5} />
                            </span>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
