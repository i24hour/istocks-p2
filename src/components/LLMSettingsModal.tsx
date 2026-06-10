'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Key, Bot, ExternalLink, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, Trash2, BarChart2 } from 'lucide-react'
import { useTheme } from './ThemeProvider'

// ── Provider definitions (client-side copy of llm-client.ts LLM_PROVIDERS) ───
const PROVIDERS = [
  {
    id: 'bedrock',
    label: 'Claude Sonnet 4.6 (Bedrock)',
    keyLabel: 'AWS Bearer Token',
    keyHint: 'Set AWS_BEARER_TOKEN_BEDROCK in environment variables',
    keyLink: 'https://console.aws.amazon.com/bedrock',
    placeholder: 'ABSK…',
    models: ['global.anthropic.claude-sonnet-4-6'],
    defaultModel: 'global.anthropic.claude-sonnet-4-6',
    color: '#FF9900',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API Key',
    keyHint: 'Get it at platform.openai.com/api-keys',
    keyLink: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-…',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o-mini',
    color: '#10a37f',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API Key',
    keyHint: 'Get it at openrouter.ai/keys — access hundreds of models',
    keyLink: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-…',
    models: [
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.1-405b-instruct',
      'deepseek/deepseek-r1',
      'mistralai/mistral-large',
    ],
    defaultModel: 'anthropic/claude-3.5-sonnet',
    color: '#7c3aed',
  },
  {
    id: 'groq',
    label: 'Groq (Ultra-fast)',
    keyLabel: 'Groq API Key',
    keyHint: 'Get it at console.groq.com/keys',
    keyLink: 'https://console.groq.com/keys',
    placeholder: 'gsk_…',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    defaultModel: 'llama-3.3-70b-versatile',
    color: '#f97316',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    keyLabel: 'Anthropic API Key',
    keyHint: 'Get it at console.anthropic.com/settings/keys',
    keyLink: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-…',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-3-5-haiku-20241022',
    color: '#d97706',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    keyLabel: 'API Key',
    keyHint: 'Any OpenAI-compatible server — Ollama, LM Studio, Together AI, etc.',
    keyLink: null,
    placeholder: 'your-api-key',
    models: [],
    defaultModel: '',
    color: '#6b7280',
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

interface SavedConfig {
  provider: string | null
  model: string | null
  baseUrl: string | null
  hasApiKey: boolean
  maskedKey: string | null
}

interface UsageStats {
  promptCount: number
  totalTokensIn: number
  totalTokensOut: number
  totalTokens: number
  memberSince: string
}

export default function LLMSettingsModal({ open, onClose }: Props) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [saved, setSaved] = useState<SavedConfig | null>(null)
  const [usage, setUsage] = useState<UsageStats | null>(null)

  // Form state
  const [providerId, setProviderId] = useState('gemini')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [customModelInput, setCustomModelInput] = useState('')
  const [showKey, setShowKey] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)

  const provider = PROVIDERS.find(p => p.id === providerId) ?? PROVIDERS[0]
  const modelOptions = provider.models as string[]
  const isCustomProvider = providerId === 'custom'

  // ── Load saved config ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setStatus(null)
    setLoading(true)
    Promise.all([
      fetch('/api/user/llm-settings').then(r => r.json()),
      fetch('/api/user/usage').then(r => r.json()).catch(() => null),
    ])
      .then(([llmData, usageData]) => {
        setSaved(llmData)
        if (llmData.provider) {
          setProviderId(llmData.provider)
          setModel(llmData.model ?? '')
          setBaseUrl(llmData.baseUrl ?? '')
          setCustomModelInput(llmData.model ?? '')
        } else {
          setProviderId('bedrock')
          setModel('global.anthropic.claude-sonnet-4-6')
        }
        setApiKey('')
        if (usageData && !usageData.error) setUsage(usageData)
      })
      .catch(() => setSaved(null))
      .finally(() => setLoading(false))
  }, [open])

  // When provider changes, reset model to default
  const handleProviderChange = (id: string) => {
    setProviderId(id)
    const prov = PROVIDERS.find(p => p.id === id)
    setModel(prov?.defaultModel ?? '')
    setCustomModelInput(prov?.defaultModel ?? '')
    setBaseUrl('')
    setApiKey('')
  }

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!apiKey.trim() && !saved?.hasApiKey) {
      setStatus({ type: 'error', msg: 'API key is required.' })
      return
    }
    if (!model.trim() && !customModelInput.trim()) {
      setStatus({ type: 'error', msg: 'Model name is required.' })
      return
    }
    if (isCustomProvider && !baseUrl.trim()) {
      setStatus({ type: 'error', msg: 'Base URL is required for custom providers.' })
      return
    }

    setSaving(true)
    setStatus(null)
    try {
      const keyToSend = apiKey.trim() || undefined // if empty, server keeps existing key
      const res = await fetch('/api/user/llm-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          apiKey: keyToSend !== undefined ? keyToSend : (saved?.hasApiKey ? '__keep__' : ''),
          model: isCustomProvider ? customModelInput.trim() : model,
          baseUrl: isCustomProvider ? baseUrl.trim() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setStatus({ type: 'success', msg: 'Saved! Your custom LLM will be used for all analyses.' })
      setSaved(prev => ({
        ...prev!,
        provider: providerId,
        model: isCustomProvider ? customModelInput.trim() : model,
        baseUrl: isCustomProvider ? baseUrl.trim() : null,
        hasApiKey: true,
        maskedKey: null, // will reload on next open
      }))
      setApiKey('')
    } catch (e: any) {
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setSaving(false)
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────
  const handleClear = async () => {
    setClearing(true)
    setStatus(null)
    try {
      const res = await fetch('/api/user/llm-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: '' }),
      })
      if (!res.ok) throw new Error('Clear failed')
      setSaved({ provider: null, model: null, baseUrl: null, hasApiKey: false, maskedKey: null })
      setProviderId('bedrock')
      setModel('global.anthropic.claude-sonnet-4-6')
      setApiKey('')
      setBaseUrl('')
      setStatus({ type: 'success', msg: 'Cleared. Using system Claude Sonnet 4.6.' })
    } catch (e: any) {
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setClearing(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: isDark ? '#1a1a2e' : '#f0f0ff' }}
            >
              <Bot className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                AI Model Settings
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Use your own LLM API key for analysis
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            <>
              {/* Info banner */}
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: isDark ? '#0f2027' : '#f0fdf4', border: `1px solid ${isDark ? '#1e3a5f' : '#bbf7d0'}` }}
              >
                <p style={{ color: isDark ? '#86efac' : '#166534' }}>
                  <strong>How it works:</strong> Your API key is stored securely on the server.
                  iStocks uses it only when making analysis requests — the same system prompts and
                  data context are sent, just to <em>your</em> model instead of the default Gemini.
                  Intent classification always uses Gemini (no API cost).
                </p>
              </div>

              {/* Token usage */}
              {usage && (
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{ background: isDark ? '#0d1b2a' : '#f0f9ff', border: `1px solid ${isDark ? '#1e3a5f' : '#bae6fd'}` }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart2 className="w-4 h-4" style={{ color: isDark ? '#38bdf8' : '#0284c7' }} />
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: isDark ? '#38bdf8' : '#0284c7' }}>
                      Your Usage
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className="rounded-lg px-3 py-2 text-center"
                      style={{ background: isDark ? '#0f2027' : '#e0f2fe', border: `1px solid ${isDark ? '#164e63' : '#7dd3fc'}` }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Prompts sent</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color: isDark ? '#7dd3fc' : '#0369a1' }}>
                        {usage.promptCount.toLocaleString()}
                      </p>
                    </div>
                    <div
                      className="rounded-lg px-3 py-2 text-center"
                      style={{ background: isDark ? '#0f2027' : '#e0f2fe', border: `1px solid ${isDark ? '#164e63' : '#7dd3fc'}` }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total tokens used</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color: isDark ? '#7dd3fc' : '#0369a1' }}>
                        {usage.totalTokens.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className="rounded-lg px-3 py-2"
                      style={{ background: isDark ? '#0f2027' : '#f0fdf4', border: `1px solid ${isDark ? '#14532d' : '#bbf7d0'}` }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Input tokens</p>
                      <p className="text-sm font-semibold mt-0.5" style={{ color: isDark ? '#86efac' : '#166534' }}>
                        {usage.totalTokensIn.toLocaleString()}
                      </p>
                    </div>
                    <div
                      className="rounded-lg px-3 py-2"
                      style={{ background: isDark ? '#0f2027' : '#fff7ed', border: `1px solid ${isDark ? '#7c2d12' : '#fed7aa'}` }}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Output tokens</p>
                      <p className="text-sm font-semibold mt-0.5" style={{ color: isDark ? '#fdba74' : '#9a3412' }}>
                        {usage.totalTokensOut.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Member since {new Date(usage.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </p>
                </div>
              )}

              {/* Currently active */}
              {saved?.hasApiKey && (
                <div
                  className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: 'var(--bg-surface-hover)', border: '1px solid var(--border-subtle)' }}
                >
                  <div>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      Currently active
                    </p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                      {PROVIDERS.find(p => p.id === saved.provider)?.label ?? saved.provider}{' '}
                      — <span style={{ color: 'var(--accent)' }}>{saved.model}</span>
                    </p>
                    <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                      {saved.maskedKey ?? '••••••••••••'}
                    </p>
                  </div>
                  <button
                    onClick={handleClear}
                    disabled={clearing}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: '#ef4444', border: '1px solid #ef4444' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Reset to default
                  </button>
                </div>
              )}

              {/* Provider selector */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Provider
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderChange(p.id)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all"
                      style={{
                        background: providerId === p.id ? (isDark ? '#1a1a3e' : '#ede9fe') : 'var(--bg-surface-hover)',
                        border: `1px solid ${providerId === p.id ? p.color : 'var(--border-subtle)'}`,
                        color: providerId === p.id ? p.color : 'var(--text-secondary)',
                        boxShadow: providerId === p.id ? `0 0 0 2px ${p.color}22` : 'none',
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: p.color }}
                      />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    {provider.keyLabel}
                  </label>
                  {provider.keyLink && (
                    <a
                      href={provider.keyLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--accent)' }}
                    >
                      Get key <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={saved?.hasApiKey ? '(leave blank to keep existing key)' : provider.placeholder}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl text-sm focus:outline-none transition-colors"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  {provider.keyHint}
                </p>
              </div>

              {/* Model picker */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Model
                </label>
                {isCustomProvider ? (
                  <input
                    type="text"
                    value={customModelInput}
                    onChange={e => setCustomModelInput(e.target.value)}
                    placeholder="e.g. llama3, mistral, phi-3"
                    className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-colors"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {modelOptions.map(m => (
                      <button
                        key={m}
                        onClick={() => setModel(m)}
                        className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all"
                        style={{
                          background: model === m ? provider.color : 'var(--bg-surface-hover)',
                          color: model === m ? '#fff' : 'var(--text-secondary)',
                          border: `1px solid ${model === m ? provider.color : 'var(--border-subtle)'}`,
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Base URL (custom only) */}
              {isCustomProvider && (
                <div>
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-colors font-mono"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Must point to an OpenAI-compatible /v1 endpoint
                  </p>
                </div>
              )}

              {/* Status feedback */}
              {status && (
                <div
                  className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
                  style={{
                    background: status.type === 'success' ? (isDark ? '#0a2a0a' : '#f0fdf4') : (isDark ? '#2a0a0a' : '#fef2f2'),
                    border: `1px solid ${status.type === 'success' ? '#22c55e' : '#ef4444'}`,
                    color: status.type === 'success' ? '#22c55e' : '#ef4444',
                  }}
                >
                  {status.type === 'success'
                    ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  {status.msg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div
            className="flex items-center justify-end gap-3 px-6 py-4"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm transition-colors"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all text-white"
              style={{
                background: saving ? 'var(--text-muted)' : 'var(--accent)',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save & Activate'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
