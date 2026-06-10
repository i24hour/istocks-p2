'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type ThemeMode = 'light-tritanopia' | 'dark' | 'claude-code'

interface ThemeContextType {
    theme: ThemeMode
    setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
    theme: 'light-tritanopia',
    setTheme: () => { },
})

export const useTheme = () => useContext(ThemeContext)

export default function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemeMode>('light-tritanopia')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        const saved = localStorage.getItem('istocks-theme') as ThemeMode | null
        if (saved && (saved === 'light-tritanopia' || saved === 'dark' || saved === 'claude-code')) {
            setThemeState(saved)
        }
        setMounted(true)
    }, [])

    useEffect(() => {
        if (!mounted) return
        const root = document.documentElement
        root.classList.remove('theme-light-tritanopia', 'theme-dark', 'theme-claude-code')
        root.classList.add(`theme-${theme}`)
        localStorage.setItem('istocks-theme', theme)
    }, [theme, mounted])

    const setTheme = (t: ThemeMode) => setThemeState(t)

    const themeStyles: Record<ThemeMode, { background: string; color: string }> = {
        'light-tritanopia': {
            background: '#f8f6f1',
            color: '#1c1917',
        },
        dark: {
            background: '#000000',
            color: '#ffffff',
        },
        'claude-code': {
            background: '#faf9f5',
            color: '#141413',
        },
    }

    // Full-page wrapper that overrides any hardcoded dark backgrounds
    const wrapperStyle: React.CSSProperties = {
        minHeight: '100vh',
        background: mounted ? themeStyles[theme].background : themeStyles['light-tritanopia'].background,
        color: mounted ? themeStyles[theme].color : themeStyles['light-tritanopia'].color,
        transition: 'background-color 0.3s ease, color 0.3s ease',
    }

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            <div id="theme-root" style={wrapperStyle}>
                {children}
            </div>
        </ThemeContext.Provider>
    )
}
