'use client'

import { useState } from 'react'
import {
  Link2,
  Unplug,
  Save,
  Loader2,
  KeyRound,
  Copy,
  ExternalLink,
  Check,
  ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/ThemeProvider'
import { LiquidButton } from '@/components/ui/liquid-glass-button'
import {
  AngelOneLogo,
  DhanLogo,
  GrowwLogo,
  ZerodhaLogo,
} from '@/components/trading/broker-logos'

export type Broker = 'ZERODHA' | 'DHAN' | 'GROWW' | 'ANGELONE'

type BrokerStatus = {
  configured: boolean
  connected: boolean
  lastValidatedAt: string | null
}

type BrokerConnectListProps = {
  brokers: Record<Broker, BrokerStatus>
  staticIp: string
  zerodhaApiKey: string
  setZerodhaApiKey: (v: string) => void
  zerodhaApiSecret: string
  setZerodhaApiSecret: (v: string) => void
  dhanApiKey: string
  setDhanApiKey: (v: string) => void
  dhanApiSecret: string
  setDhanApiSecret: (v: string) => void
  dhanClientId: string
  setDhanClientId: (v: string) => void
  growwApiKey: string
  setGrowwApiKey: (v: string) => void
  growwApiSecret: string
  setGrowwApiSecret: (v: string) => void
  angelApiKey: string
  setAngelApiKey: (v: string) => void
  angelClientCode: string
  setAngelClientCode: (v: string) => void
  savingCreds: Broker | null
  connecting: Broker | null
  disconnecting: Broker | null
  brokerError: Partial<Record<Broker, string>>
  onSaveCredentials: (broker: Broker) => void
  onConnect: (broker: Broker) => void
  onDisconnect: (broker: Broker) => void
}

const BROKER_ORDER: Broker[] = ['ANGELONE', 'DHAN', 'GROWW', 'ZERODHA']

const BROKER_META: Record<
  Broker,
  { name: string; tagline: string; Logo: typeof AngelOneLogo }
> = {
  ANGELONE: { name: 'Angel One', tagline: 'SmartAPI OAuth', Logo: AngelOneLogo },
  DHAN: { name: 'Dhan', tagline: 'API Key + Client ID', Logo: DhanLogo },
  GROWW: { name: 'Groww', tagline: 'Trade API + static IP', Logo: GrowwLogo },
  ZERODHA: { name: 'Zerodha', tagline: 'Kite Connect OAuth', Logo: ZerodhaLogo },
}

function statusBadge(status: BrokerStatus, isDark: boolean) {
  if (status.connected) {
    return {
      label: 'Connected',
      className: isDark
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    }
  }
  if (status.configured) {
    return {
      label: 'Configured',
      className: isDark
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
        : 'bg-amber-50 text-amber-700 border-amber-200',
    }
  }
  return {
    label: 'Not connected',
    className: isDark
      ? 'bg-white/5 text-gray-400 border-white/10'
      : 'bg-gray-100 text-gray-500 border-gray-200',
  }
}

export function BrokerConnectList(props: BrokerConnectListProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [expandedBroker, setExpandedBroker] = useState<Broker | null>(null)
  const [copiedIp, setCopiedIp] = useState(false)

  const inputClass = cn(
    'w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm transition-all focus:ring-2 outline-none',
    isDark
      ? 'bg-dark-400/50 border-white/10 text-white placeholder:text-gray-500 focus:border-emerald-500/50 focus:ring-emerald-500/20'
      : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-emerald-500/50 focus:ring-emerald-500/20',
  )

  const guidePanelClass = cn(
    'rounded-xl border p-4 space-y-3',
    isDark ? 'bg-emerald-500/8 border-white/10' : 'bg-emerald-50/60 border-emerald-100',
  )

  const guidePanelClassCompact = cn(
    'rounded-xl border p-4 space-y-2',
    isDark ? 'bg-emerald-500/8 border-white/10' : 'bg-emerald-50/60 border-emerald-100',
  )

  const copyIp = async () => {
    try {
      await navigator.clipboard.writeText(props.staticIp)
      setCopiedIp(true)
      setTimeout(() => setCopiedIp(false), 2000)
    } catch {
      /* clipboard blocked */
    }
  }

  const toggleExpand = (broker: Broker) => {
    setExpandedBroker((prev) => (prev === broker ? null : broker))
  }

  const StaticIpBlock = ({ note }: { note?: string }) => (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-2',
        isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white border-emerald-100',
      )}
    >
      <p className={cn('text-xs font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
        Static IP (whitelist on broker)
      </p>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'flex-1 px-2.5 py-1.5 rounded-lg font-mono text-xs border',
            isDark
              ? 'bg-dark-400/50 text-emerald-400 border-white/10'
              : 'bg-gray-50 text-emerald-700 border-gray-200',
          )}
        >
          {props.staticIp}
        </code>
        <button
          type="button"
          onClick={copyIp}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition border',
            isDark
              ? 'border-white/10 bg-dark-400/50 text-gray-300 hover:bg-white/5'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          {copiedIp ? (
            <>
              <Check className={cn('w-3 h-3', isDark ? 'text-emerald-400' : 'text-emerald-600')} /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>
      {note && <p className={cn('text-[10px]', isDark ? 'text-gray-500' : 'text-gray-500')}>{note}</p>}
    </div>
  )

  const renderSetupGuide = (broker: Broker) => {
    switch (broker) {
      case 'GROWW':
        return (
          <div className={guidePanelClass}>
            <p className={cn('text-xs font-semibold', isDark ? 'text-white' : 'text-gray-900')}>How to connect Groww</p>
            <ol className={cn('text-[11px] space-y-2 list-decimal pl-4', isDark ? 'text-gray-400' : 'text-gray-600')}>
              <li>
                Open{' '}
                <a
                  href="https://groww.in/trade-api/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex items-center gap-1 font-semibold underline', isDark ? 'text-emerald-400' : 'text-emerald-700')}
                >
                  groww.in/trade-api/api-keys <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Click <span className="font-semibold">Update static IP</span> and paste our IP (below).
              </li>
              <li>
                Click <span className="font-semibold">Generate API key</span> (not one-time access token).
              </li>
              <li>
                Paste <span className="font-semibold">API Key</span> and <span className="font-semibold">API Secret</span> below, then Save.
              </li>
            </ol>
            <StaticIpBlock note="Groww resets access daily at 6 AM IST — tap Authorize again after reset." />
          </div>
        )
      case 'ANGELONE':
        return (
          <div className={guidePanelClass}>
            <p className={cn('text-xs font-semibold', isDark ? 'text-white' : 'text-gray-900')}>How to connect Angel One</p>
            <ol className={cn('text-[11px] space-y-2 list-decimal pl-4', isDark ? 'text-gray-400' : 'text-gray-600')}>
              <li>
                Open{' '}
                <a
                  href="https://smartapi.angelone.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex items-center gap-1 font-semibold underline', isDark ? 'text-emerald-400' : 'text-emerald-700')}
                >
                  smartapi.angelone.in <ExternalLink className="w-3 h-3" />
                </a>{' '}
                → Create app → copy API Key.
              </li>
              <li>Add our static IP in app settings (SEBI compliance).</li>
              <li>
                Enter <span className="font-semibold">API Key</span> and <span className="font-semibold">Client Code</span> (login ID) below, then Save.
              </li>
              <li>Click <span className="font-semibold">Authorize</span> to log in on Angel One.</li>
            </ol>
            <StaticIpBlock />
          </div>
        )
      case 'DHAN':
        return (
          <div className={guidePanelClassCompact}>
            <p className={cn('text-xs font-semibold', isDark ? 'text-white' : 'text-gray-900')}>How to connect Dhan</p>
            <ol className={cn('text-[11px] space-y-1.5 list-decimal pl-4', isDark ? 'text-gray-400' : 'text-gray-600')}>
              <li>
                Open Dhan developer / API settings and create API credentials.
              </li>
              <li>
                Paste <span className="font-semibold">API Key</span>, <span className="font-semibold">API Secret</span>, and{' '}
                <span className="font-semibold">Client ID</span> below.
              </li>
              <li>Save, then Authorize to complete the connection.</li>
            </ol>
          </div>
        )
      case 'ZERODHA':
        return (
          <div className={guidePanelClassCompact}>
            <p className={cn('text-xs font-semibold', isDark ? 'text-white' : 'text-gray-900')}>How to connect Zerodha</p>
            <ol className={cn('text-[11px] space-y-1.5 list-decimal pl-4', isDark ? 'text-gray-400' : 'text-gray-600')}>
              <li>
                Create a Kite Connect app at{' '}
                <a
                  href="https://developers.kite.trade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex items-center gap-1 font-semibold underline', isDark ? 'text-emerald-400' : 'text-emerald-700')}
                >
                  developers.kite.trade <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Paste <span className="font-semibold">API Key</span> and <span className="font-semibold">API Secret</span> below, then Save.
              </li>
              <li>Click Authorize — you will be redirected to Zerodha login.</li>
            </ol>
          </div>
        )
    }
  }

  const renderFields = (broker: Broker) => {
    switch (broker) {
      case 'ZERODHA':
        return (
          <>
            <FieldInput icon={KeyRound} type="text" value={props.zerodhaApiKey} onChange={props.setZerodhaApiKey} placeholder="API Key" className={inputClass} isDark={isDark} />
            <FieldInput icon={KeyRound} type="password" value={props.zerodhaApiSecret} onChange={props.setZerodhaApiSecret} placeholder="API Secret" className={inputClass} isDark={isDark} />
          </>
        )
      case 'DHAN':
        return (
          <>
            <FieldInput icon={KeyRound} type="text" value={props.dhanApiKey} onChange={props.setDhanApiKey} placeholder="API Key" className={inputClass} isDark={isDark} />
            <FieldInput icon={KeyRound} type="password" value={props.dhanApiSecret} onChange={props.setDhanApiSecret} placeholder="API Secret" className={inputClass} isDark={isDark} />
            <FieldInput icon={KeyRound} type="text" value={props.dhanClientId} onChange={props.setDhanClientId} placeholder="Dhan Client ID" className={inputClass} isDark={isDark} />
          </>
        )
      case 'GROWW':
        return (
          <>
            <FieldInput icon={KeyRound} type="text" value={props.growwApiKey} onChange={props.setGrowwApiKey} placeholder="API Key" className={inputClass} isDark={isDark} />
            <FieldInput icon={KeyRound} type="password" value={props.growwApiSecret} onChange={props.setGrowwApiSecret} placeholder="API Secret" className={inputClass} isDark={isDark} />
          </>
        )
      case 'ANGELONE':
        return (
          <>
            <FieldInput icon={KeyRound} type="text" value={props.angelApiKey} onChange={props.setAngelApiKey} placeholder="API Key (SmartAPI)" className={inputClass} isDark={isDark} />
            <FieldInput icon={KeyRound} type="text" value={props.angelClientCode} onChange={props.setAngelClientCode} placeholder="Client Code (e.g. A123456)" className={inputClass} isDark={isDark} />
          </>
        )
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-2xl border overflow-hidden shadow-sm',
        isDark ? 'bg-dark-300/40 border-white/10' : 'bg-white border-gray-200',
      )}
    >
      <div
        className={cn(
          'px-5 py-4 border-b',
          isDark ? 'bg-white/[0.02] border-white/10' : 'bg-gray-50 border-gray-100',
        )}
      >
        <h2 className={cn('text-lg font-bold', isDark ? 'text-white' : 'text-gray-900')}>Broker connections</h2>
        <p className={cn('text-sm mt-0.5', isDark ? 'text-gray-400' : 'text-gray-500')}>
          Connect a broker for live trading. Tap Connect to enter API credentials.
        </p>
      </div>

      <ul className={cn('divide-y', isDark ? 'divide-white/10' : 'divide-gray-100')}>
        {BROKER_ORDER.map((broker) => {
          const meta = BROKER_META[broker]
          const status = props.brokers[broker]
          const badge = statusBadge(status, isDark)
          const isExpanded = expandedBroker === broker
          const Logo = meta.Logo

          return (
            <li key={broker}>
              <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <div
                  className={cn(
                    'shrink-0 rounded-xl border p-0.5',
                    isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white',
                  )}
                >
                  <Logo className="rounded-lg" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>{meta.name}</p>
                    <span
                      className={cn(
                        'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className={cn('text-xs mt-0.5', isDark ? 'text-gray-500' : 'text-gray-500')}>{meta.tagline}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleExpand(broker)}
                  className={cn(
                    'shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border',
                    isExpanded
                      ? isDark
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : isDark
                        ? 'bg-white/5 text-emerald-400 border-white/10 hover:bg-white/10'
                        : 'bg-white text-emerald-700 border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {isExpanded ? (
                    <>
                      <ChevronDown className="w-4 h-4 rotate-180" />
                      Close
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" />
                      Connect
                    </>
                  )}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div
                      className={cn(
                        'px-4 pb-5 sm:px-5 space-y-4 border-t',
                        isDark ? 'border-white/10 bg-black/20' : 'border-gray-100 bg-gray-50/50',
                      )}
                    >
                      {renderSetupGuide(broker)}
                      <div className="space-y-3">{renderFields(broker)}</div>
                      {props.brokerError[broker] && (
                        <p className={cn('text-xs font-medium', isDark ? 'text-red-400' : 'text-red-600')}>
                          {props.brokerError[broker]}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <LiquidButton
                          variant="outline"
                          onClick={() => props.onSaveCredentials(broker)}
                          disabled={props.savingCreds === broker}
                          className="min-w-[120px]"
                        >
                          {props.savingCreds === broker ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          Save credentials
                        </LiquidButton>
                        <LiquidButton
                          variant="soft"
                          onClick={() => props.onConnect(broker)}
                          disabled={props.connecting === broker || !status.configured}
                          title={!status.configured ? 'Save credentials first' : undefined}
                          className="min-w-[140px]"
                        >
                          {props.connecting === broker ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Link2 className="w-4 h-4" />
                          )}
                          Authorize
                        </LiquidButton>
                        {status.connected && (
                          <LiquidButton
                            variant="destructive"
                            onClick={() => props.onDisconnect(broker)}
                            disabled={props.disconnecting === broker}
                            className="min-w-[120px]"
                          >
                            {props.disconnecting === broker ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Unplug className="w-4 h-4" />
                            )}
                            Disconnect
                          </LiquidButton>
                        )}
                      </div>
                      {!status.configured && (
                        <p className={cn('text-[11px]', isDark ? 'text-gray-500' : 'text-gray-500')}>
                          Save your API credentials before Authorize.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </motion.section>
  )
}

function FieldInput({
  icon: Icon,
  className,
  onChange,
  isDark,
  ...props
}: Omit<React.ComponentProps<'input'>, 'onChange'> & {
  icon: typeof KeyRound
  onChange: (value: string) => void
  isDark: boolean
}) {
  return (
    <div className="relative">
      <Icon className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4', isDark ? 'text-gray-500' : 'text-gray-400')} />
      <input
        {...props}
        className={className}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
