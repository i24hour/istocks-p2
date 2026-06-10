'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Search, Menu, X, LogOut, BarChart3, Palette, Check, Bot, Key } from 'lucide-react'
import { useTheme, ThemeMode } from './ThemeProvider'
import LLMSettingsModal from './LLMSettingsModal'

// iStocks bar-chart logo as inline SVG — red/green candle colors
const IStocksLogo = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 40 32" className={className} fill="none">
    {/* Bar 1 — bullish green */}
    <rect x="0" y="4" width="6" height="28" rx="1" fill="#52c49a" />
    {/* Bar 2 — bearish red */}
    <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
    {/* Bar 3 — bullish green */}
    <rect x="16" y="14" width="6" height="18" rx="1" fill="#52c49a" />
    {/* Bar 4 — bearish red */}
    <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
    {/* Bar 5 — bullish green */}
    <rect x="32" y="2" width="6" height="30" rx="1" fill="#52c49a" />
  </svg>
)

const themes: { id: ThemeMode; name: string; description: string; preview: { bg: string; bar1: string; bar2: string; dot1: string; dot2: string } }[] = [
  {
    id: 'light-tritanopia',
    name: 'Light Tritanopia',
    description: 'Clean neutral light theme with green accents',
    preview: { bg: '#f9fafb', bar1: '#52a88c', bar2: '#e5e7eb', dot1: '#52a88c', dot2: '#c53030' },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Classic dark theme',
    preview: { bg: '#0a0a0a', bar1: '#52c49a', bar2: '#333', dot1: '#52c49a', dot2: '#ef4444' },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic warm neutrals with clay accents',
    preview: { bg: '#faf9f5', bar1: '#d97757', bar2: '#d1cfc5', dot1: '#788c5d', dot2: '#d97757' },
  },
]

import { FloatingHeader } from './ui/floating-header'

export default function Header() {
  const [showAppearance, setShowAppearance] = useState(false)
  const [showLLMSettings, setShowLLMSettings] = useState(false)
  const appearanceRef = useRef<HTMLDivElement>(null)
  const { theme, setTheme } = useTheme()

  // Close appearance menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (appearanceRef.current && !appearanceRef.current.contains(event.target as Node)) {
        setShowAppearance(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Trading Agent sidebar triggers these modals without the floating header
  useEffect(() => {
    const openAppearance = () => setShowAppearance(true)
    const openLlm = () => setShowLLMSettings(true)
    window.addEventListener('istocks-open-appearance', openAppearance)
    window.addEventListener('istocks-open-llm-settings', openLlm)
    return () => {
      window.removeEventListener('istocks-open-appearance', openAppearance)
      window.removeEventListener('istocks-open-llm-settings', openLlm)
    }
  }, [])

  // Theme-aware styles
  const isDark = theme === 'dark'

  return (
    <>
      {/* ── Floating Header ──────────────────────────────── */}
      <FloatingHeader
        onShowAppearance={() => setShowAppearance(true)}
        onShowLLMSettings={() => setShowLLMSettings(true)}
      />

      {/* ── LLM Settings Modal ───────────────────────────── */}
      <LLMSettingsModal open={showLLMSettings} onClose={() => setShowLLMSettings(false)} />

      {/* ── Appearance Modal ──────────────────────────────── */}
      {/* Appearance modal */}
      {showAppearance && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)' }}
            onClick={() => setShowAppearance(false)}
          />
          <div
            ref={appearanceRef}
            className="relative w-full max-w-md rounded-2xl p-6 transition-colors"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {/* Close */}
            <button
              onClick={() => setShowAppearance(false)}
              className="absolute top-4 right-4 p-1 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
              >
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Appearance</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Choose how iStocks looks to you</p>
              </div>
            </div>

            {/* Theme cards */}
            <div className="space-y-3">
              {themes.map(t => {
                const isActive = theme === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className="w-full flex items-center gap-4 p-3 rounded-xl border transition-all text-left"
                    style={{
                      background: isActive ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                      borderColor: isActive ? 'var(--accent)' : 'var(--border-color)',
                    }}
                  >
                    {/* Mini preview */}
                    <div
                      className="w-16 h-12 rounded-lg flex-shrink-0 border overflow-hidden flex items-end justify-center gap-0.5 p-1"
                      style={{ background: t.preview.bg, borderColor: 'var(--border-color)' }}
                    >
                      {/* Mini bar chart */}
                      <div className="w-2 rounded-t" style={{ height: '60%', background: t.preview.bar1 }} />
                      <div className="w-2 rounded-t" style={{ height: '80%', background: t.preview.bar1 }} />
                      <div className="w-2 rounded-t" style={{ height: '40%', background: t.preview.bar2 }} />
                      <div className="w-2 rounded-t" style={{ height: '70%', background: t.preview.bar1 }} />
                      {/* Dots for status indicators */}
                      <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                        <div className="w-1 h-1 rounded-full" style={{ background: t.preview.dot1 }} />
                        <div className="w-1 h-1 rounded-full" style={{ background: t.preview.dot2 }} />
                      </div>
                    </div>

                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                    </div>

                    {/* Check mark */}
                    {isActive && (
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <p className="text-xs mt-4 text-center" style={{ color: 'var(--text-muted)' }}>
              Theme is applied immediately and saved automatically.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
