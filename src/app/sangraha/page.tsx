'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
    TrendingUp, Search, Filter, Star, GitFork, Clock,
    Lock, Globe, Plus, ChevronDown, User, BarChart3,
    ArrowLeft
} from 'lucide-react'
import Link from 'next/link'

interface Strategy {
    id: string
    name: string
    description: string
    stockSymbol: string | null
    strategyType: string
    tags: string[]
    visibility: string
    stars: number
    forks: number
    isStarred: boolean
    backtestCount: number
    createdAt: string
    author: {
        id: string
        name: string | null
        image: string | null
    }
}

export default function SangrahaPage() {
    const router = useRouter()
    const { data: session } = useSession()

    const [strategies, setStrategies] = useState<Strategy[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'mine' | 'starred'>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [typeFilter, setTypeFilter] = useState('')

    useEffect(() => {
        fetchStrategies()
    }, [filter, typeFilter])

    const fetchStrategies = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set('filter', filter)
            if (typeFilter) params.set('type', typeFilter)
            if (searchQuery) params.set('search', searchQuery)

            const response = await fetch(`/api/sangraha?${params}`)
            const data = await response.json()

            if (data.success) {
                setStrategies(data.data)
            }
        } catch (error) {
            console.error('Error fetching strategies:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        fetchStrategies()
    }

    const toggleStar = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!session) {
            router.push('/login')
            return
        }

        try {
            const response = await fetch(`/api/sangraha/${id}/star`, { method: 'POST' })
            const data = await response.json()

            if (data.success) {
                setStrategies(prev => prev.map(s =>
                    s.id === id
                        ? { ...s, isStarred: data.starred, stars: s.stars + (data.starred ? 1 : -1) }
                        : s
                ))
            }
        } catch (error) {
            console.error('Error toggling star:', error)
        }
    }

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'probability': return 'bg-blue-500/20 text-blue-400'
            case 'entry_exit': return 'bg-emerald-500/20 text-emerald-400'
            case 'pattern': return 'bg-purple-500/20 text-purple-400'
            case 'indicator': return 'bg-orange-500/20 text-orange-400'
            default: return 'bg-gray-500/20 text-gray-400'
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 pt-24">
            <main className="max-w-7xl mx-auto px-4 pb-8">
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-white">Sangraha</h1>
                    <p className="text-sm text-gray-400 mt-1">Strategy marketplace — browse, star, and fork shared algos.</p>
                </div>
                {/* Filters */}
                <div className="flex flex-col md:flex-row gap-4 mb-8">
                    <form onSubmit={handleSearch} className="flex-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search strategies..."
                                className="w-full pl-11 pr-4 py-3 bg-dark-400/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                    </form>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-xl font-medium transition-colors ${filter === 'all'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-dark-400/50 text-gray-400 hover:text-white'
                                }`}
                        >
                            <Globe className="w-4 h-4 inline mr-2" />
                            Public
                        </button>
                        {session && (
                            <>
                                <button
                                    onClick={() => setFilter('mine')}
                                    className={`px-4 py-2 rounded-xl font-medium transition-colors ${filter === 'mine'
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-dark-400/50 text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <User className="w-4 h-4 inline mr-2" />
                                    My Strategies
                                </button>
                                <button
                                    onClick={() => setFilter('starred')}
                                    className={`px-4 py-2 rounded-xl font-medium transition-colors ${filter === 'starred'
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-dark-400/50 text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <Star className="w-4 h-4 inline mr-2" />
                                    Starred
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Strategy List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
                    </div>
                ) : strategies.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="w-16 h-16 bg-dark-400/50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <BarChart3 className="w-8 h-8 text-gray-500" />
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-2">No strategies found</h3>
                        <p className="text-gray-400 mb-6">
                            {filter === 'mine'
                                ? "You haven't created any strategies yet."
                                : filter === 'starred'
                                    ? "You haven't starred any strategies yet."
                                    : "Be the first to share a strategy!"}
                        </p>
                        {session && (
                            <Link
                                href="/sangraha/new"
                                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white font-medium rounded-xl hover:bg-emerald-600 transition-colors"
                            >
                                <Plus className="w-5 h-5" />
                                Create Strategy
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {strategies.map((strategy) => (
                            <div
                                key={strategy.id}
                                onClick={() => router.push(`/sangraha/${strategy.id}`)}
                                className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 hover:border-emerald-500/30 cursor-pointer transition-all"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h3 className="text-xl font-semibold text-white hover:text-emerald-400">
                                                {strategy.name}
                                            </h3>
                                            {strategy.visibility === 'private' && (
                                                <Lock className="w-4 h-4 text-gray-500" />
                                            )}
                                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getTypeColor(strategy.strategyType)}`}>
                                                {strategy.strategyType}
                                            </span>
                                        </div>

                                        <p className="text-gray-400 mb-3 line-clamp-2">
                                            {strategy.description || 'No description'}
                                        </p>

                                        <div className="flex items-center gap-4 text-sm text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <User className="w-4 h-4" />
                                                {strategy.author.name || 'Anonymous'}
                                            </span>
                                            {strategy.stockSymbol && (
                                                <span className="px-2 py-0.5 bg-dark-400 rounded text-gray-400">
                                                    {strategy.stockSymbol}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-4 h-4" />
                                                {new Date(strategy.createdAt).toLocaleDateString('en-IN')}
                                            </span>
                                        </div>

                                        {strategy.tags.length > 0 && (
                                            <div className="flex gap-2 mt-3">
                                                {strategy.tags.slice(0, 5).map((tag) => (
                                                    <span key={tag} className="px-2 py-0.5 bg-dark-400/50 text-gray-400 text-xs rounded-full">
                                                        #{tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-4 ml-4">
                                        <button
                                            onClick={(e) => toggleStar(strategy.id, e)}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${strategy.isStarred
                                                ? 'bg-yellow-500/20 text-yellow-400'
                                                : 'bg-dark-400/50 text-gray-400 hover:text-yellow-400'
                                                }`}
                                        >
                                            <Star className={`w-4 h-4 ${strategy.isStarred ? 'fill-current' : ''}`} />
                                            {strategy.stars}
                                        </button>
                                        <div className="flex items-center gap-1 px-3 py-1.5 bg-dark-400/50 rounded-lg text-gray-400">
                                            <GitFork className="w-4 h-4" />
                                            {strategy.forks}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}
