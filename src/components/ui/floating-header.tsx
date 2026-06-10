'use client';

import React, { useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { MenuIcon, LogOut, BarChart3, Palette, Bot, Key, Search, XIcon, Zap, Crown, Activity } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import { NavBar } from './tubelight-navbar';
import { APP_NAV_ITEMS } from '@/config/app-navigation';

// Bar chart mark — green (Light Tritanopia + default light) / emerald (dark)
const IStocksLogo = ({ className = '' }: { className?: string }) => (
    <svg viewBox="0 0 40 32" className={className} fill="none">
        <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
        <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
        <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
        <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
        <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
    </svg>
);

/** Clay / terracotta bars for Claude Code theme */
const IStocksLogoClay = ({ className = '' }: { className?: string }) => (
    <svg viewBox="0 0 40 32" className={className} fill="none">
        <rect x="0" y="4" width="6" height="28" rx="1" fill="#d97757" />
        <rect x="8" y="0" width="6" height="32" rx="1" fill="#c45a3c" />
        <rect x="16" y="14" width="6" height="18" rx="1" fill="#e07a5f" />
        <rect x="24" y="8" width="6" height="24" rx="1" fill="#b4532a" />
        <rect x="32" y="2" width="6" height="30" rx="1" fill="#d97757" />
    </svg>
);

function HeaderBrandMark({ isDark, isClaude, onClick }: { isDark: boolean; isClaude: boolean; onClick: () => void }) {
    const clay = isClaude && !isDark;
    return (
        <div
            className={cn(
                'shrink-0 flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors',
                isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'
            )}
            onClick={onClick}
        >
            {clay ? <IStocksLogoClay className="size-6 lg:size-7" /> : <IStocksLogo className="size-6 lg:size-7" />}
            <span
                className="hidden sm:inline text-lg lg:text-xl font-bold bg-clip-text text-transparent"
                style={{
                    backgroundImage: isDark
                        ? 'linear-gradient(to right, #34d399, #52c49a)'
                        : clay
                          ? 'linear-gradient(to right, #d97757, #b4532a)'
                          : 'linear-gradient(to right, #52a88c, #6bb89a)',
                }}
            >
                iStocks
            </span>
        </div>
    );
}

interface FloatingHeaderProps {
    onShowAppearance: () => void;
    onShowLLMSettings: () => void;
}

export function FloatingHeader({ onShowAppearance, onShowLLMSettings }: FloatingHeaderProps) {
    const [open, setOpen] = React.useState(false);
    const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
    const [isVisible, setIsVisible] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState('');
    type ProfileUsage = {
        plan: 'free' | 'pro'
        prompts: { used: number; limit: number; remaining: number }
        experts: { used: number; limit: number; remaining: number }
        attachments: { available: boolean; used: number; limit: number; remaining: number }
        subscription: { expiresAt: string | null; daysRemaining: number | null }
    }
    const [usageData, setUsageData] = React.useState<ProfileUsage | null>(null);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    const router = useRouter();
    const pathname = usePathname();
    const { data: session } = useSession();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const isClaude = theme === 'claude-code';

    const avatarGradient = isDark
        ? 'linear-gradient(135deg, #52c49a, #22c55e)'
        : isClaude
          ? 'linear-gradient(135deg, #d97757, #c45a3c)'
          : 'linear-gradient(135deg, #52a88c, #6bb89a)';

    const broadcastSearch = React.useCallback((query: string) => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('istocks-search', { detail: { query } }));
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const next = new URLSearchParams(window.location.search).get('q') || '';
        setSearchQuery(next);
    }, [pathname]);

    useEffect(() => {
        if (pathname !== '/stocks') return;
        if (typeof window === 'undefined') return;
        const currentQuery = (new URLSearchParams(window.location.search).get('q') || '').trim();
        const nextQuery = searchQuery.trim();
        if (currentQuery === nextQuery) return;

        const id = window.setTimeout(() => {
            if (!nextQuery) {
                broadcastSearch('');
                router.replace('/stocks');
                return;
            }
            broadcastSearch(nextQuery);
            router.replace(`/stocks?q=${encodeURIComponent(nextQuery)}`);
        }, 200);

        return () => window.clearTimeout(id);
    }, [broadcastSearch, pathname, router, searchQuery]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
                setProfileMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!profileMenuOpen || !session?.user) return;
        fetch('/api/user/usage', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(json => {
                if (!json?.success || !json.data) return
                const d = json.data
                setUsageData({
                    plan: d.plan === 'pro' ? 'pro' : 'free',
                    prompts: {
                        used: d.prompts?.used ?? 0,
                        limit: d.prompts?.limit ?? 10,
                        remaining: d.prompts?.remaining ?? 0,
                    },
                    experts: {
                        used: d.experts?.used ?? 0,
                        limit: d.experts?.limit ?? 0,
                        remaining: d.experts?.remaining ?? 0,
                    },
                    attachments: {
                        available: !!d.attachments?.available,
                        used: d.attachments?.used ?? 0,
                        limit: d.attachments?.limit ?? 0,
                        remaining: d.attachments?.remaining ?? 0,
                    },
                    subscription: {
                        expiresAt: d.subscription?.expiresAt ?? null,
                        daysRemaining: d.subscription?.daysRemaining ?? null,
                    },
                })
            })
            .catch(() => {});
    }, [profileMenuOpen, session?.user]);

    useEffect(() => {
        let lastScrollY = window.scrollY;

        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Hide on scroll down past a certain threshold
            if (currentScrollY > lastScrollY && currentScrollY > 50) {
                setIsVisible(false);
            }
            // Show on scroll up
            else if (currentScrollY < lastScrollY) {
                setIsVisible(true);
            }

            lastScrollY = currentScrollY;
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const userInitial = () => {
        if (session?.user?.name) return session.user.name.charAt(0).toUpperCase();
        if (session?.user?.email) return session.user.email.charAt(0).toUpperCase();
        return 'P';
    };

    const handleSignOut = async () => {
        setProfileMenuOpen(false);
        await signOut({ callbackUrl: '/' });
    };

    const submitSearch = React.useCallback((rawQuery: string) => {
        const query = rawQuery.trim();
        broadcastSearch(query);
        if (!query) {
            if (pathname === '/stocks') {
                router.replace('/stocks');
            } else {
                router.push('/stocks');
            }
            return;
        }

        const encoded = encodeURIComponent(query);
        if (pathname === '/stocks') {
            router.replace(`/stocks?q=${encoded}`);
        } else {
            router.push(`/stocks?q=${encoded}`);
        }
    }, [broadcastSearch, pathname, router]);

    if (pathname?.startsWith('/database-chat') || pathname?.startsWith('/experts')) {
        return null;
    }

    return (
        <header
            className={cn(
                'sticky top-5 z-[40]', // z-[40] to stay below modals
                'mx-auto w-full max-w-6xl rounded-2xl border shadow-lg transition-all duration-300 ease-in-out',
                isVisible ? 'translate-y-0 opacity-100' : '-translate-y-[150%] opacity-0',
                isDark
                    ? 'bg-dark-300/80 border-white/10 shadow-black/50'
                    : 'bg-white/90 border-gray-200 shadow-gray-200/50',
                'supports-[backdrop-filter]:backdrop-blur-xl'
            )}
        >
            <nav className="mx-auto flex min-w-0 items-center justify-between gap-2 p-2 lg:gap-3 lg:px-4 lg:py-2.5">
                {/* Brand — logo always visible, text hidden on mobile */}
                <HeaderBrandMark isDark={isDark} isClaude={isClaude} onClick={() => router.push('/stocks')} />

                {/* Desktop Links (Tubelight Navbar) */}
                <NavBar items={APP_NAV_ITEMS} className="hidden lg:flex" />

                {/* Actions (Search, Profile/Login, Mobile Menu) */}
                <div className="flex shrink-0 items-center gap-2 lg:gap-2.5">
                    {/* Search (Desktop Only) */}
                    <div className="hidden lg:flex relative min-w-0">
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    submitSearch(searchQuery);
                                }
                            }}
                            className={`pl-9 pr-3 py-1.5 text-sm rounded-lg outline-none focus:ring-2 transition-colors w-32 xl:w-48 2xl:w-56 max-w-[12rem] xl:max-w-[14rem] ${isDark ? 'bg-dark-400/50 border border-white/10 text-white placeholder-gray-500 focus:ring-emerald-500/20 focus:border-emerald-500/50' : isClaude ? 'bg-gray-100/50 border border-gray-200 text-gray-900 placeholder-gray-500 focus:ring-[#d97757]/25 focus:border-[#d97757]' : 'bg-gray-100/50 border border-gray-200 text-gray-900 placeholder-gray-500 focus:ring-emerald-500/20 focus:border-emerald-500/50'}`}
                        />
                    </div>

                    {/* Profile Menu Dropdown */}
                    <div className="relative hidden shrink-0 lg:block" ref={profileMenuRef}>
                        {session?.user ? (
                            <button
                                onClick={() => setProfileMenuOpen((prev) => !prev)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold border transition-transform hover:scale-105"
                                style={{
                                    background: avatarGradient,
                                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                }}
                            >
                                {userInitial()}
                            </button>
                        ) : (
                            <Button
                                onClick={() => router.push('/login')}
                                size="sm"
                                className={`rounded-lg font-semibold text-white ${isDark ? 'bg-emerald-600 hover:bg-emerald-500' : isClaude ? 'bg-[#d97757] hover:bg-[#c45a3c]' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                            >
                                Sign In
                            </Button>
                        )}

                        {/* Dropdown Content */}
                        {profileMenuOpen && session?.user && (
                            <div
                                className={`absolute right-0 mt-3 w-60 rounded-xl shadow-xl overflow-hidden border ${isDark ? 'bg-dark-300 border-white/10 shadow-black/50' : 'bg-white border-gray-200 shadow-gray-200/50'}`}
                            >
                                {/* User info */}
                                <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10 bg-dark-400/30' : 'border-gray-100 bg-gray-50/50'}`}>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Signed in as</p>
                                    <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{session.user.email}</p>
                                </div>

                                {/* Usage widget */}
                                <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                                    {usageData ? (
                                        usageData.plan === 'pro' ? (
                                            <div className="flex items-center gap-2">
                                                <Crown className="w-4 h-4 text-amber-500 shrink-0" />
                                                <div>
                                                    <p className="text-xs font-semibold text-amber-500">Pro Plan</p>
                                                    {usageData.subscription.expiresAt ? (
                                                        <p className={`text-[11px] ${isDark ? 'text-amber-200/80' : 'text-amber-700'}`}>
                                                            Ends{' '}
                                                            {new Date(usageData.subscription.expiresAt).toLocaleDateString('en-IN', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric',
                                                            })}
                                                            {usageData.subscription.daysRemaining != null
                                                                ? ` · ${usageData.subscription.daysRemaining}d left`
                                                                : ''}
                                                        </p>
                                                    ) : (
                                                        <p className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Active</p>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                        <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Daily Usage</span>
                                                    </div>
                                                    <span className={`text-xs font-bold ${usageData.prompts.used >= usageData.prompts.limit ? 'text-red-500' : isDark ? 'text-white' : 'text-gray-900'}`}>
                                                        {usageData.prompts.used}/{usageData.prompts.limit}
                                                    </span>
                                                </div>
                                                <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                                                    <div
                                                        className="h-full rounded-full transition-all duration-300"
                                                        style={{
                                                            width: `${Math.min(100, (usageData.prompts.used / Math.max(1, usageData.prompts.limit)) * 100)}%`,
                                                            background: usageData.prompts.used >= usageData.prompts.limit
                                                                ? '#ef4444'
                                                                : usageData.prompts.used >= usageData.prompts.limit * 0.8
                                                                ? '#f59e0b'
                                                                : '#52c49a',
                                                        }}
                                                    />
                                                </div>
                                                <p className={`text-[11px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {usageData.prompts.used >= usageData.prompts.limit
                                                        ? 'Limit reached — resets at midnight IST'
                                                        : `${usageData.prompts.remaining} prompts left today`}
                                                </p>
                                                {usageData.prompts.used >= usageData.prompts.limit * 0.7 && (
                                                    <button
                                                        onClick={() => { setProfileMenuOpen(false); router.push('/pricing'); }}
                                                        className="mt-2 w-full text-[11px] font-semibold py-1 rounded-lg bg-gradient-to-r from-emerald-500 to-green-500 text-white transition-opacity hover:opacity-90"
                                                    >
                                                        Upgrade to Pro — ₹499/mo
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    ) : (
                                        <div className={`h-8 rounded-lg animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
                                    )}
                                </div>

                                <div className="p-1.5 flex flex-col gap-0.5">
                                    <button onClick={() => { setProfileMenuOpen(false); router.push('/pnl') }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}>
                                        <BarChart3 className="w-4 h-4" /> P&L
                                    </button>
                                    <button onClick={() => { setProfileMenuOpen(false); onShowLLMSettings(); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}>
                                        <Bot className="w-4 h-4" /> AI Model
                                    </button>
                                    <button onClick={() => { setProfileMenuOpen(false); router.push('/trading/settings') }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}>
                                        <Key className="w-4 h-4" /> Broker Keys
                                    </button>
                                    <button onClick={() => { setProfileMenuOpen(false); router.push('/account/usage') }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}>
                                        <Activity className="w-4 h-4" /> Usage
                                    </button>
                                    <button onClick={() => { setProfileMenuOpen(false); onShowAppearance(); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}>
                                        <Palette className="w-4 h-4" /> Appearance
                                    </button>
                                    <div className={`my-1 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`} />
                                    <button onClick={handleSignOut} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors font-medium ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>
                                        <LogOut className="w-4 h-4" /> Logout
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Mobile Menu Trigger */}
                    <Sheet open={open} onOpenChange={setOpen}>
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setOpen(!open)}
                            className={`lg:hidden rounded-lg ${isDark ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                        >
                            <MenuIcon className="size-5" />
                        </Button>

                        {/* Mobile Menu Content */}
                        <SheetContent
                            side="left"
                            showClose={false} // Custom close logic integrated
                            className={cn(
                                'w-[85vw] max-w-sm p-0 flex flex-col',
                                isDark ? 'bg-dark-300 border-r-white/10' : 'bg-white border-r-gray-200'
                            )}
                        >
                            {/* Mobile Header */}
                            <div className={`p-4 flex items-center justify-between border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                                <div className="flex items-center gap-2">
                                    {isClaude && !isDark ? <IStocksLogoClay className="size-6" /> : <IStocksLogo className="size-6" />}
                                    <span className="text-xl font-bold bg-clip-text text-transparent" style={{ backgroundImage: isDark ? 'linear-gradient(to right, #34d399, #52c49a)' : isClaude ? 'linear-gradient(to right, #d97757, #b4532a)' : 'linear-gradient(to right, #52a88c, #6bb89a)' }}>
                                        iStocks
                                    </span>
                                </div>
                                <button onClick={() => setOpen(false)} className={`p-2 rounded-lg ${isDark ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}>
                                    <XIcon className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Mobile Links */}
                            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                                {/* Search (Mobile) */}
                                <div className="relative mb-5 px-1">
                                    <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                    <input
                                        type="text"
                                        placeholder="Search..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                submitSearch(searchQuery);
                                                setOpen(false);
                                            }
                                        }}
                                        className={`w-full pl-10 pr-4 py-2 text-sm rounded-xl outline-none focus:ring-2 transition-colors ${isDark ? 'bg-dark-400/50 border border-white/10 text-white placeholder-gray-500 focus:ring-emerald-500/20' : isClaude ? 'bg-gray-100 border border-transparent text-gray-900 placeholder-gray-500 focus:bg-white focus:border-[#d97757] focus:ring-[#d97757]/25' : 'bg-gray-100 border border-transparent text-gray-900 placeholder-gray-500 focus:bg-white focus:border-emerald-500/50 focus:ring-emerald-500/20'}`}
                                    />
                                </div>

                                {/* Navigation */}
                                <div className="space-y-1">
                                    <p className={`px-3 pb-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Menu</p>
                                    {APP_NAV_ITEMS.map((link) => (
                                        <button
                                            key={link.name}
                                            onClick={() => { setOpen(false); router.push(link.url); }}
                                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <link.icon className="w-4 h-4 opacity-70" />
                                                <span>{link.name}</span>
                                            </div>
                                            {link.badge && (
                                                <span className="text-[9px] bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wider">
                                                    {link.badge}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>

                                {/* Mobile Profile Actions */}
                                <div className={`mt-6 pt-5 space-y-1 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                                    {session?.user ? (
                                        <>
                                            <p className={`px-3 pb-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Account</p>
                                            <div className={`mx-3 mb-3 px-3 py-2 rounded-xl border flex items-center gap-3 ${isDark ? 'bg-dark-400/30 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: avatarGradient }}>
                                                    {userInitial()}
                                                </div>
                                                <div className="flex-1 overflow-hidden">
                                                    <p className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Signed In</p>
                                                    <p className={`text-xs font-semibold truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{session.user.email}</p>
                                                </div>
                                            </div>

                                            <button onClick={() => { setOpen(false); router.push('/pnl') }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                <BarChart3 className="w-4 h-4" /> P&L
                                            </button>
                                            <button onClick={() => { setOpen(false); onShowLLMSettings(); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                <Bot className="w-4 h-4" /> AI Model
                                            </button>
                                            <button onClick={() => { setOpen(false); router.push('/trading/settings') }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                <Key className="w-4 h-4" /> Broker Keys
                                            </button>
                                            <button onClick={() => { setOpen(false); router.push('/account/usage') }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                <Activity className="w-4 h-4" /> Usage
                                            </button>
                                            <button onClick={() => { setOpen(false); onShowAppearance(); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                                                <Palette className="w-4 h-4" /> Appearance
                                            </button>
                                            <button onClick={handleSignOut} className={`w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>
                                                <LogOut className="w-4 h-4" /> Logout
                                            </button>
                                        </>
                                    ) : (
                                        <div className="px-3 pt-2 pb-4">
                                            <Button onClick={() => { setOpen(false); router.push('/login'); }} className={`w-full rounded-xl py-5 font-semibold text-white ${isDark ? 'bg-emerald-600 hover:bg-emerald-500' : isClaude ? 'bg-[#d97757] hover:bg-[#c45a3c]' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                                                Sign In to iStocks
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </nav>
        </header>
    );
}
