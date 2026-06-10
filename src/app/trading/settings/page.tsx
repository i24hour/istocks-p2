'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Save, ArrowLeft, Loader2 } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import { motion, AnimatePresence } from 'framer-motion'
import { LiquidButton } from '@/components/ui/liquid-glass-button'
import { BrokerConnectList } from '@/components/trading/broker-connect-list'

type Broker = 'ZERODHA' | 'DHAN' | 'GROWW' | 'ANGELONE'
type Mode = 'PAPER' | 'LIVE'

type BrokerStatus = {
  configured: boolean
  connected: boolean
  lastValidatedAt: string | null
}

type SettingsState = {
  tradingMode: Mode
  preferredLiveBroker: Broker | null
  brokers: Record<Broker, BrokerStatus>
}

const DEFAULT_SETTINGS: SettingsState = {
  tradingMode: 'PAPER',
  preferredLiveBroker: null,
  brokers: {
    ZERODHA: { configured: false, connected: false, lastValidatedAt: null },
    DHAN: { configured: false, connected: false, lastValidatedAt: null },
    GROWW: { configured: false, connected: false, lastValidatedAt: null },
    ANGELONE: { configured: false, connected: false, lastValidatedAt: null },
  },
}

export default function TradingSettingsPage() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [zerodhaApiKey, setZerodhaApiKey] = useState('')
  const [zerodhaApiSecret, setZerodhaApiSecret] = useState('')

  const [dhanApiKey, setDhanApiKey] = useState('')
  const [dhanApiSecret, setDhanApiSecret] = useState('')
  const [dhanClientId, setDhanClientId] = useState('')

  const [growwApiKey, setGrowwApiKey] = useState('')
  const [growwApiSecret, setGrowwApiSecret] = useState('')

  const [angelApiKey, setAngelApiKey] = useState('')
  const [angelClientCode, setAngelClientCode] = useState('')

  const [savingCreds, setSavingCreds] = useState<Broker | null>(null)
  const [connecting, setConnecting] = useState<Broker | null>(null)
  const [disconnecting, setDisconnecting] = useState<Broker | null>(null)
  const [brokerError, setBrokerError] = useState<Partial<Record<Broker, string>>>({})

  const STATIC_IP = process.env.NEXT_PUBLIC_BROKER_STATIC_IP || '4.224.60.60'

  const callbackNotice = useMemo(() => {
    const broker = searchParams.get('broker')
    const connected = searchParams.get('connected')
    const message = searchParams.get('message')
    if (!broker || !connected) return null
    const prefix = connected === '1' ? 'Connected' : 'Connection failed'
    return `${prefix}: ${broker}${message ? ` - ${message}` : ''}`
  }, [searchParams])

  const loadSettings = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/trading/settings', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Failed to load settings')

      setSettings({
        tradingMode: j.data.tradingMode === 'LIVE' ? 'LIVE' : 'PAPER',
        preferredLiveBroker:
          j.data.preferredLiveBroker === 'ZERODHA' || j.data.preferredLiveBroker === 'DHAN' || j.data.preferredLiveBroker === 'GROWW' || j.data.preferredLiveBroker === 'ANGELONE'
            ? j.data.preferredLiveBroker
            : null,
        brokers: {
          ZERODHA: j.data.brokers?.ZERODHA || DEFAULT_SETTINGS.brokers.ZERODHA,
          DHAN: j.data.brokers?.DHAN || DEFAULT_SETTINGS.brokers.DHAN,
          GROWW: j.data.brokers?.GROWW || DEFAULT_SETTINGS.brokers.GROWW,
          ANGELONE: j.data.brokers?.ANGELONE || DEFAULT_SETTINGS.brokers.ANGELONE,
        },
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated') {
      loadSettings()
    }
  }, [status])

  useEffect(() => {
    if (callbackNotice) setNotice(callbackNotice)
  }, [callbackNotice])

  const savePreferences = async () => {
    setSavingPrefs(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch('/api/trading/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradingMode: settings.tradingMode,
          preferredLiveBroker: settings.preferredLiveBroker,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Failed to save preferences')
      setNotice('Trading preferences saved')
      await loadSettings()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingPrefs(false)
    }
  }

  const saveBrokerCredentials = async (broker: Broker) => {
    setSavingCreds(broker)
    setError(null)
    setNotice(null)
    setBrokerError(prev => ({ ...prev, [broker]: '' }))

    try {
      const payload =
        broker === 'ZERODHA'
          ? { apiKey: zerodhaApiKey, apiSecret: zerodhaApiSecret }
          : broker === 'DHAN'
            ? { apiKey: dhanApiKey, apiSecret: dhanApiSecret, clientId: dhanClientId }
            : broker === 'ANGELONE'
              ? { apiKey: angelApiKey, clientId: angelClientCode }
              : { apiKey: growwApiKey, apiSecret: growwApiSecret }

      const r = await fetch(`/api/trading/brokers/${broker.toLowerCase()}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await r.json()
      if (!r.ok || !j?.success) throw new Error(j?.error || `Failed to save ${broker} credentials`)

      setNotice(`${broker} credentials saved`)
      await loadSettings()
    } catch (e: any) {
      setBrokerError(prev => ({ ...prev, [broker]: e.message }))
    } finally {
      setSavingCreds(null)
    }
  }

  const connectBroker = async (broker: Broker) => {
    setConnecting(broker)
    setError(null)
    setNotice(null)
    setBrokerError(prev => ({ ...prev, [broker]: '' }))
    try {
      const r = await fetch(`/api/trading/brokers/${broker.toLowerCase()}/connect/start`, {
        method: 'POST',
      })
      const j = await r.json()
      if (!r.ok || !j?.success || !j?.data?.redirectUrl) {
        throw new Error(j?.error || `Failed to start ${broker} connect flow`)
      }

      window.location.href = j.data.redirectUrl
    } catch (e: any) {
      setBrokerError(prev => ({ ...prev, [broker]: e.message }))
      setConnecting(null)
    }
  }

  const disconnectBroker = async (broker: Broker) => {
    setDisconnecting(broker)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch(`/api/trading/brokers/${broker.toLowerCase()}/disconnect`, {
        method: 'DELETE',
      })
      const j = await r.json()
      if (!r.ok || !j?.success) throw new Error(j?.error || `Failed to disconnect ${broker}`)

      setNotice(`${broker} disconnected`)
      await loadSettings()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDisconnecting(null)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-dark-200' : 'bg-gray-50'}`}>
        <Loader2 className={`w-8 h-8 animate-spin ${isDark ? 'text-emerald-500' : 'text-emerald-600'}`} />
      </div>
    )
  }

  const containerVariants: any = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut", staggerChildren: 0.1 } }
  }

  const itemVariants: any = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? 'bg-dark-200' : 'bg-gray-50'}`}>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <button
          onClick={() => router.push('/database-chat')} // Redirecting to /database-chat to match new app flow
          className={`inline-flex items-center gap-2 text-sm transition-colors ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <ArrowLeft className="w-4 h-4" /> Back to Trading
        </button>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Main Settings Card */}
          <motion.div variants={itemVariants} className={`rounded-2xl border p-6 space-y-5 shadow-sm ${isDark ? 'bg-dark-300/40 border-white/10' : 'bg-white border-gray-200'}`}>
            <div>
              <h1 className={`text-2xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>Trading Settings</h1>
              <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Configure paper/live mode and broker connections.</p>
            </div>

            <AnimatePresence>
              {notice && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={`px-4 py-3 rounded-xl border text-sm ${isDark ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                  {notice}
                </motion.div>
              )}

              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={`px-4 py-3 rounded-xl border text-sm ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid md:grid-cols-2 gap-5">
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-dark-400/30 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <p className={`text-[11px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Default Mode</p>
                <div className={`mt-3 flex rounded-lg border overflow-hidden p-1 ${isDark ? 'border-white/10 bg-dark-400/50' : 'border-gray-200 bg-gray-100/50'}`}>
                  <button
                    onClick={() => setSettings(s => ({ ...s, tradingMode: 'PAPER' }))}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${settings.tradingMode === 'PAPER' ? (isDark ? 'bg-yellow-500/20 text-yellow-400 shadow-sm' : 'bg-yellow-100 text-yellow-700 shadow-sm') : (isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')}`}
                  >
                    PAPER
                  </button>
                  <button
                    onClick={() => setSettings(s => ({ ...s, tradingMode: 'LIVE' }))}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${settings.tradingMode === 'LIVE' ? (isDark ? 'bg-emerald-500/20 text-emerald-400 shadow-sm' : 'bg-emerald-100 text-emerald-700 shadow-sm') : (isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')}`}
                  >
                    LIVE
                  </button>
                </div>
              </div>

              <div className={`rounded-xl border p-4 ${isDark ? 'bg-dark-400/30 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <p className={`text-[11px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Preferred Live Broker</p>
                <select
                  value={settings.preferredLiveBroker || ''}
                  onChange={(e) =>
                    setSettings(s => ({
                      ...s,
                      preferredLiveBroker: (e.target.value || null) as Broker | null,
                    }))
                  }
                  className={`mt-3 w-full border font-medium rounded-lg px-3 py-2.5 text-sm transition-colors focus:ring-2 outline-none ${isDark ? 'bg-dark-300 border-white/10 text-white focus:border-emerald-500/50 focus:ring-emerald-500/20' : 'bg-white border-gray-200 text-gray-900 focus:border-emerald-500/50 focus:ring-emerald-500/20'}`}
                >
                  <option value="">Select broker</option>
                  <option value="ZERODHA">ZERODHA</option>
                  <option value="DHAN">DHAN</option>
                  <option value="GROWW">GROWW</option>
                  <option value="ANGELONE">ANGEL ONE</option>
                </select>
              </div>
            </div>

            <LiquidButton
              variant="soft"
              onClick={savePreferences}
              disabled={savingPrefs}
            >
              {savingPrefs ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingPrefs ? 'Saving...' : 'Save Preferences'}
            </LiquidButton>
          </motion.div>

          <motion.div variants={itemVariants}>
            <BrokerConnectList
              brokers={settings.brokers}
              staticIp={STATIC_IP}
              zerodhaApiKey={zerodhaApiKey}
              setZerodhaApiKey={setZerodhaApiKey}
              zerodhaApiSecret={zerodhaApiSecret}
              setZerodhaApiSecret={setZerodhaApiSecret}
              dhanApiKey={dhanApiKey}
              setDhanApiKey={setDhanApiKey}
              dhanApiSecret={dhanApiSecret}
              setDhanApiSecret={setDhanApiSecret}
              dhanClientId={dhanClientId}
              setDhanClientId={setDhanClientId}
              growwApiKey={growwApiKey}
              setGrowwApiKey={setGrowwApiKey}
              growwApiSecret={growwApiSecret}
              setGrowwApiSecret={setGrowwApiSecret}
              angelApiKey={angelApiKey}
              setAngelApiKey={setAngelApiKey}
              angelClientCode={angelClientCode}
              setAngelClientCode={setAngelClientCode}
              savingCreds={savingCreds}
              connecting={connecting}
              disconnecting={disconnecting}
              brokerError={brokerError}
              onSaveCredentials={saveBrokerCredentials}
              onConnect={connectBroker}
              onDisconnect={disconnectBroker}
            />
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}
