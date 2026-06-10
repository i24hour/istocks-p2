'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
    Star, GitFork, Clock, Lock, Globe, Edit, Trash2,
    ArrowLeft, Play, BarChart3, User, Calendar, Code, FileText,
    Copy, Check, ExternalLink
} from 'lucide-react'
import Link from 'next/link'

interface Strategy {
    id: string
    name: string
    description: string
    readme: string
    naturalInput: string
    strategyCode: any
    sqlQuery: string | null
    stockSymbol: string | null
    strategyType: string
    tags: string[]
    visibility: string
    stars: number
    forks: number
    isStarred: boolean
    isOwner: boolean
    starCount: number
    forkCount: number
    createdAt: string
    updatedAt: string
    author: {
        id: string
        name: string | null
        image: string | null
    }
    backtests: {
        id: string
        stockSymbol: string
        startDate: string
        endDate: string
        totalTrades: number
        winRate: number
        totalPnL: number
        status: string
        createdAt: string
    }[]
    forkedFrom: {
        id: string
        name: string
        author: { name: string }
    } | null
}

export default function StrategyDetailPage() {
    const params = useParams()
    const router = useRouter()
    const { data: session } = useSession()
    const id = params.id as string

    const [strategy, setStrategy] = useState<Strategy | null>(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'readme' | 'code' | 'backtests'>('readme')
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        fetchStrategy()
    }, [id])

    const fetchStrategy = async () => {
        try {
            const response = await fetch(`/api/sangraha/${id}`)
            const data = await response.json()

            if (data.success) {
                setStrategy(data.data)
            } else {
                router.push('/sangraha')
            }
        } catch (error) {
            console.error('Error fetching strategy:', error)
        } finally {
            setLoading(false)
        }
    }

    const toggleStar = async () => {
        if (!session) {
            router.push('/login')
            return
        }

        try {
            const response = await fetch(`/api/sangraha/${id}/star`, { method: 'POST' })
            const data = await response.json()

            if (data.success && strategy) {
                setStrategy({
                    ...strategy,
                    isStarred: data.starred,
                    starCount: strategy.starCount + (data.starred ? 1 : -1)
                })
            }
        } catch (error) {
            console.error('Error toggling star:', error)
        }
    }

    const handleFork = async () => {
        if (!session) {
            router.push('/login')
            return
        }

        try {
            const response = await fetch(`/api/sangraha/${id}/fork`, { method: 'POST' })
            const data = await response.json()

            if (data.success) {
                router.push(`/sangraha/${data.data.id}`)
            }
        } catch (error) {
            console.error('Error forking strategy:', error)
        }
    }

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this strategy?')) return

        try {
            const response = await fetch(`/api/sangraha/${id}`, { method: 'DELETE' })
            const data = await response.json()

            if (data.success) {
                router.push('/sangraha')
            }
        } catch (error) {
            console.error('Error deleting strategy:', error)
        }
    }

    const copyCode = () => {
        if (strategy?.strategyCode) {
            navigator.clipboard.writeText(JSON.stringify(strategy.strategyCode, null, 2))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            </div>
        )
    }

    if (!strategy) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24 flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-white mb-2">Strategy not found</h1>
                    <Link href="/sangraha" className="text-emerald-400 hover:underline">
                        Back to Sangraha
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24">
            <main className="max-w-7xl mx-auto px-4 pb-8">
                <nav className="flex items-center gap-3 mb-6">
                    <Link
                        href="/sangraha"
                        className="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Sangraha
                    </Link>
                </nav>
                {/* Strategy Header */}
                <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 mb-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <h1 className="text-3xl font-bold text-white">{strategy.name}</h1>
                                {strategy.visibility === 'private' ? (
                                    <Lock className="w-5 h-5 text-gray-500" />
                                ) : (
                                    <Globe className="w-5 h-5 text-gray-500" />
                                )}
                            </div>

                            <p className="text-gray-400 mb-4">{strategy.description || 'No description'}</p>

                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span className="flex items-center gap-1">
                                    <User className="w-4 h-4" />
                                    {strategy.author.name || 'Anonymous'}
                                </span>
                                {strategy.stockSymbol && (
                                    <Link href={`/stock/${strategy.stockSymbol}`} className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">
                                        {strategy.stockSymbol}
                                    </Link>
                                )}
                                <span className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    {new Date(strategy.createdAt).toLocaleDateString('en-IN')}
                                </span>
                            </div>

                            {strategy.forkedFrom && (
                                <div className="mt-3 text-sm text-gray-500">
                                    <GitFork className="w-4 h-4 inline mr-1" />
                                    Forked from{' '}
                                    <Link href={`/sangraha/${strategy.forkedFrom.id}`} className="text-emerald-400 hover:underline">
                                        {strategy.forkedFrom.name}
                                    </Link>
                                    {' '}by {strategy.forkedFrom.author.name}
                                </div>
                            )}

                            {strategy.tags.length > 0 && (
                                <div className="flex gap-2 mt-4">
                                    {strategy.tags.map((tag) => (
                                        <span key={tag} className="px-2 py-1 bg-dark-400/50 text-gray-400 text-sm rounded-full">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={toggleStar}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors ${strategy.isStarred
                                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                        : 'bg-dark-400/50 text-gray-400 hover:text-yellow-400 border border-white/10'
                                    }`}
                            >
                                <Star className={`w-4 h-4 ${strategy.isStarred ? 'fill-current' : ''}`} />
                                {strategy.starCount}
                            </button>

                            <button
                                onClick={handleFork}
                                className="flex items-center gap-2 px-4 py-2 bg-dark-400/50 text-gray-400 hover:text-white rounded-xl font-medium border border-white/10 transition-colors"
                            >
                                <GitFork className="w-4 h-4" />
                                Fork {strategy.forkCount}
                            </button>

                            {strategy.isOwner && (
                                <>
                                    <Link
                                        href={`/sangraha/${id}/edit`}
                                        className="p-2 bg-dark-400/50 text-gray-400 hover:text-white rounded-xl border border-white/10"
                                    >
                                        <Edit className="w-5 h-5" />
                                    </Link>
                                    <button
                                        onClick={handleDelete}
                                        className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl border border-red-500/20"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('readme')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors ${activeTab === 'readme'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-dark-400/50 text-gray-400 hover:text-white'
                            }`}
                    >
                        <FileText className="w-4 h-4" />
                        README
                    </button>
                    <button
                        onClick={() => setActiveTab('code')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors ${activeTab === 'code'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-dark-400/50 text-gray-400 hover:text-white'
                            }`}
                    >
                        <Code className="w-4 h-4" />
                        Code
                    </button>
                    <button
                        onClick={() => setActiveTab('backtests')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors ${activeTab === 'backtests'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-dark-400/50 text-gray-400 hover:text-white'
                            }`}
                    >
                        <BarChart3 className="w-4 h-4" />
                        Backtests ({strategy.backtests.length})
                    </button>
                </div>

                {/* Content */}
                <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
                    {activeTab === 'readme' && (
                        <div className="p-6 prose prose-invert max-w-none">
                            <pre className="whitespace-pre-wrap text-gray-300 font-sans">{strategy.readme}</pre>
                        </div>
                    )}

                    {activeTab === 'code' && (
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-white">Strategy Code</h3>
                                <button
                                    onClick={copyCode}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-dark-400/50 text-gray-400 hover:text-white rounded-lg text-sm"
                                >
                                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>

                            <div className="bg-dark-300 rounded-xl p-4 overflow-x-auto">
                                <pre className="text-sm text-gray-300">
                                    <code>{JSON.stringify(strategy.strategyCode, null, 2)}</code>
                                </pre>
                            </div>

                            {strategy.sqlQuery && (
                                <div className="mt-6">
                                    <h4 className="text-md font-semibold text-white mb-2">SQL Query</h4>
                                    <div className="bg-dark-300 rounded-xl p-4 overflow-x-auto">
                                        <pre className="text-sm text-gray-300">
                                            <code>{strategy.sqlQuery}</code>
                                        </pre>
                                    </div>
                                </div>
                            )}

                            <div className="mt-6">
                                <h4 className="text-md font-semibold text-white mb-2">Original Query</h4>
                                <div className="bg-dark-300 rounded-xl p-4">
                                    <p className="text-gray-300">{strategy.naturalInput}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'backtests' && (
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-white">Backtest Results</h3>
                                <Link
                                    href={`/sangraha/${id}/backtest`}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl font-medium hover:bg-emerald-600"
                                >
                                    <Play className="w-4 h-4" />
                                    Run Backtest
                                </Link>
                            </div>

                            {strategy.backtests.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No backtests yet. Run one to see results!</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {strategy.backtests.map((bt) => (
                                        <div
                                            key={bt.id}
                                            className="flex items-center justify-between p-4 bg-dark-400/30 rounded-xl"
                                        >
                                            <div className="flex items-center gap-4">
                                                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm font-medium">
                                                    {bt.stockSymbol}
                                                </span>
                                                <span className="text-gray-400 text-sm">
                                                    {new Date(bt.startDate).toLocaleDateString()} - {new Date(bt.endDate).toLocaleDateString()}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-center">
                                                    <div className="text-lg font-semibold text-white">{bt.totalTrades}</div>
                                                    <div className="text-xs text-gray-500">Trades</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className={`text-lg font-semibold ${bt.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {bt.winRate.toFixed(1)}%
                                                    </div>
                                                    <div className="text-xs text-gray-500">Win Rate</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className={`text-lg font-semibold ${bt.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        ₹{bt.totalPnL.toFixed(0)}
                                                    </div>
                                                    <div className="text-xs text-gray-500">P&L</div>
                                                </div>
                                                <span className={`px-2 py-1 text-xs rounded ${bt.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                                                        bt.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                            'bg-yellow-500/20 text-yellow-400'
                                                    }`}>
                                                    {bt.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
