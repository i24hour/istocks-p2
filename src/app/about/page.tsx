'use client'

import Link from 'next/link'
import {
    Brain,
    TrendingUp,
    Shield,
    Users,
    Zap,
    MessageSquare,
    BarChart3,
    Globe,
    Target,
    Rocket,
    ChevronRight,
    CheckCircle,
    ArrowRight,
    Briefcase,
    Users2,
    Search,
    Linkedin,
    ExternalLink,
    PlayCircle
} from 'lucide-react'

const teamMembers = [
    {
        name: 'Priyanshu',
        role: 'Founder & Product Engineer',
        experience: 'Building iStocks end-to-end: AI workflows, data systems, product experience, and deployment.',
        linkedin: 'https://www.linkedin.com/in/priyanshu85953/',
        linkLabel: 'LinkedIn Profile'
    },
    {
        name: 'iStocks Core Team',
        role: 'AI + Product + Trading Infrastructure',
        experience: 'Focused on prompt-to-strategy automation, market data pipelines, and reliable trading analytics UX.',
        linkedin: 'https://www.linkedin.com/company/istocks-ai/',
        linkLabel: 'LinkedIn Company Page'
    }
]

const products = [
    {
        name: 'AI Stock Dashboard',
        stage: 'Live Beta',
        description: 'Real-time stock dashboard with technical indicators, insights, and AI-assisted analysis.',
        demoLink: '/',
        assets: 'Live app demo available'
    },
    {
        name: 'AI Database Analyst',
        stage: 'Live Beta',
        description: 'Natural language stock data querying interface for fast analysis and comparison workflows.',
        demoLink: '/database-chat',
        assets: 'Live app demo available'
    },
    {
        name: 'Sangraha (Strategy Repository + Backtesting)',
        stage: 'Public Beta',
        description: 'Create, save, fork, star, and backtest AI-generated strategies with historical market data.',
        demoLink: '/sangraha',
        assets: 'Live app demo + strategy execution flow'
    }
]

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-[#0a0a0a]">
            {/* Hero Section */}
            <section className="relative pt-20 pb-32 overflow-hidden">
                {/* Gradient Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-transparent to-transparent" />
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 rounded-full border border-emerald-500/20 mb-6">
                            <Rocket className="w-4 h-4 text-emerald-400" />
                            <span className="text-emerald-400 text-sm font-medium">Revolutionizing Trading in India</span>
                        </div>

                        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
                            <span className="text-emerald-400">AI-Powered</span> Prompt
                            <br />Algo Trading Platform
                        </h1>

                        <p className="text-xl md:text-2xl text-gray-400 max-w-4xl mx-auto mb-8">
                            What if you could trade like a pro by simply saying
                            <span className="text-emerald-400 font-semibold"> &quot;Buy 100 Reliance stocks when RSI drops below 30&quot;</span>?
                        </p>

                        <p className="text-lg text-gray-500 max-w-3xl mx-auto">
                            We&apos;re democratizing algorithmic trading for India&apos;s 30 million retail traders through natural language AI.
                        </p>
                    </div>
                </div>
            </section>

            {/* Business Description */}
            <section className="py-20 bg-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Business Description
                        </h2>
                        <p className="text-gray-400 text-lg max-w-3xl mx-auto">
                            Clear overview of what we do, which problem we solve, and who this product is for.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6">
                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-7 hover:border-emerald-500/30 transition-colors">
                            <Briefcase className="w-8 h-8 text-emerald-400 mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-3">What We Do</h3>
                            <p className="text-gray-400">
                                iStocks is an AI-powered stock analysis and prompt-algo trading platform that converts natural language into actionable strategy logic.
                            </p>
                        </div>
                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-7 hover:border-emerald-500/30 transition-colors">
                            <Search className="w-8 h-8 text-emerald-400 mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-3">Problem We Solve</h3>
                            <p className="text-gray-400">
                                Most traders cannot code or build quant workflows quickly. We reduce this complexity with AI chat, strategy generation, and backtesting.
                            </p>
                        </div>
                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-7 hover:border-emerald-500/30 transition-colors">
                            <Users2 className="w-8 h-8 text-emerald-400 mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-3">Target Audience</h3>
                            <p className="text-gray-400">
                                Retail traders, semi-professional traders, and small advisory teams that need faster research, better decisions, and lower tech barriers.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Problem Section */}
            <section className="py-20 bg-gradient-to-b from-[#0a0a0a] to-[#111]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            The Problem: <span className="text-red-400">Trading Complexity Barrier</span>
                        </h2>
                        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                            Millions of Indian traders are left behind due to complex coding requirements and chart analysis
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 text-center hover:border-red-500/30 transition-colors">
                            <div className="text-5xl font-bold text-red-400 mb-4">30M+</div>
                            <h3 className="text-xl font-semibold text-white mb-2">Retail Traders</h3>
                            <p className="text-gray-500">Struggling with complex coding and chart analysis in India&apos;s growing market</p>
                        </div>

                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 text-center hover:border-red-500/30 transition-colors">
                            <div className="text-5xl font-bold text-red-400 mb-4">90%+</div>
                            <h3 className="text-xl font-semibold text-white mb-2">In Net Loss</h3>
                            <p className="text-gray-500">According to SEBI data, more than 90% of retail traders end up losing money</p>
                        </div>

                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 text-center hover:border-red-500/30 transition-colors">
                            <div className="text-5xl font-bold text-red-400 mb-4">21%</div>
                            <h3 className="text-xl font-semibold text-white mb-2">YoY Growth</h3>
                            <p className="text-gray-500">Retail trader increase, but algo trading remains inaccessible to most</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Solution Section */}
            <section className="py-20 bg-[#111]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Our Solution: <span className="text-emerald-400">Natural Language Trading</span>
                        </h2>
                        <p className="text-gray-400 text-lg max-w-3xl mx-auto">
                            iStocks transforms complex trading strategies into simple conversations. Speak your strategy in your regional language.
                        </p>
                    </div>

                    {/* Example Prompt */}
                    <div className="bg-gradient-to-r from-emerald-900/20 to-emerald-800/10 border border-emerald-500/30 rounded-2xl p-8 mb-16 max-w-4xl mx-auto">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-emerald-500/20 rounded-xl">
                                <MessageSquare className="w-6 h-6 text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-sm text-emerald-400 font-medium mb-2">Example Prompt</p>
                                <p className="text-xl text-white italic">
                                    &quot;Use Bollinger Bands - when stock touches upper band, short sell 150 RELIANCE stocks in Intraday with stop-loss at 5%&quot;
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Features Grid */}
                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-colors group">
                            <div className="p-3 bg-emerald-500/10 rounded-xl w-fit mb-6 group-hover:bg-emerald-500/20 transition-colors">
                                <MessageSquare className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-3">Voice Commands</h3>
                            <p className="text-gray-500">Speak your trading strategy in your regional language - Hindi, Tamil, Telugu, and more</p>
                        </div>

                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-colors group">
                            <div className="p-3 bg-emerald-500/10 rounded-xl w-fit mb-6 group-hover:bg-emerald-500/20 transition-colors">
                                <Brain className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-3">AI Processing</h3>
                            <p className="text-gray-500">Multi-agent system interprets, validates, and executes your trading strategies</p>
                        </div>

                        <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-colors group">
                            <div className="p-3 bg-emerald-500/10 rounded-xl w-fit mb-6 group-hover:bg-emerald-500/20 transition-colors">
                                <Shield className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-3">Risk Management</h3>
                            <p className="text-gray-500">Automatic stop-loss, position sizing, and built-in paper trading option</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="py-20 bg-gradient-to-b from-[#111] to-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            How iStocks Works
                        </h2>
                        <p className="text-gray-400 text-lg">The AI-Powered Trading Flow</p>
                    </div>

                    <div className="grid md:grid-cols-4 gap-8">
                        {[
                            {
                                step: 1,
                                title: "Natural Language Prompt",
                                description: "Type your trading intent in plain English or regional language",
                                icon: MessageSquare
                            },
                            {
                                step: 2,
                                title: "Trading Analysis Agent",
                                description: "AI interprets the prompt, analyzes market conditions",
                                icon: Brain
                            },
                            {
                                step: 3,
                                title: "Watching Agent",
                                description: "System continuously monitors market for specified conditions",
                                icon: Target
                            },
                            {
                                step: 4,
                                title: "Automated Execution",
                                description: "Trade is automatically placed when conditions are met",
                                icon: Zap
                            }
                        ].map((item, index) => (
                            <div key={index} className="relative">
                                <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-6 h-full hover:border-emerald-500/30 transition-colors">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 font-bold">
                                            {item.step}
                                        </div>
                                        <item.icon className="w-6 h-6 text-emerald-400" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                                    <p className="text-gray-500 text-sm">{item.description}</p>
                                </div>
                                {index < 3 && (
                                    <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                                        <ChevronRight className="w-8 h-8 text-emerald-500/30" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Market Opportunity */}
            <section className="py-20 bg-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Massive Market Opportunity
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-2 gap-12 items-center">
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-1" />
                                <div>
                                    <h3 className="text-xl font-semibold text-white mb-1">$11B+ Daily Trading Volume</h3>
                                    <p className="text-gray-500">Indian stock market daily trading volume</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-1" />
                                <div>
                                    <h3 className="text-xl font-semibold text-white mb-1">30M+ Retail Traders</h3>
                                    <p className="text-gray-500">Active retail traders nationwide seeking better tools</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-1" />
                                <div>
                                    <h3 className="text-xl font-semibold text-white mb-1">400K+ Semi-Professionals</h3>
                                    <p className="text-gray-500">Small institutional traders and financial advisors</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-1" />
                                <div>
                                    <h3 className="text-xl font-semibold text-white mb-1">$7B+ Accessible Volume</h3>
                                    <p className="text-gray-500">Volume from retail and semi-professional traders seeking automation</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20 rounded-3xl p-8">
                            <h3 className="text-2xl font-bold text-white mb-6">Target Segments</h3>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-gray-400">Retail Traders</span>
                                        <span className="text-emerald-400">60%</span>
                                    </div>
                                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: '60%' }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-gray-400">Semi-Professional</span>
                                        <span className="text-emerald-400">25%</span>
                                    </div>
                                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: '25%' }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-gray-400">Small Institutional</span>
                                        <span className="text-emerald-400">15%</span>
                                    </div>
                                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-300 rounded-full" style={{ width: '15%' }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Technical Innovation */}
            <section className="py-20 bg-[#111]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Technical Innovation & Competitive Advantage
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#111] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-all">
                            <Globe className="w-12 h-12 text-emerald-400 mb-6" />
                            <h3 className="text-xl font-semibold text-white mb-3">Natural Language Processing</h3>
                            <p className="text-gray-500">First platform in India to enable algo trading in regional language without writing a single line of code</p>
                        </div>

                        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#111] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-all">
                            <Brain className="w-12 h-12 text-emerald-400 mb-6" />
                            <h3 className="text-xl font-semibold text-white mb-3">Multi-Agent Architecture</h3>
                            <p className="text-gray-500">We use a multi-agent system instead of a single agent to ensure reliability and high accuracy at every stage</p>
                        </div>

                        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#111] border border-gray-800 rounded-2xl p-8 hover:border-emerald-500/30 transition-all">
                            <Users className="w-12 h-12 text-emerald-400 mb-6" />
                            <h3 className="text-xl font-semibold text-white mb-3">Democratization Focus</h3>
                            <p className="text-gray-500">Making complex algorithmic trading accessible to everyday investors across India</p>
                        </div>
                    </div>

                    <div className="mt-12 bg-[#1a1a1a] border border-gray-800 rounded-2xl p-8">
                        <h3 className="text-xl font-semibold text-white mb-4">Tech Stack</h3>
                        <div className="flex flex-wrap gap-3">
                            {['Next.js 14', 'TypeScript', 'PostgreSQL', 'Google Gemini AI', 'Angel One API', 'Prisma ORM', 'Vercel', 'TailwindCSS'].map((tech) => (
                                <span key={tech} className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
                                    {tech}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Team Information */}
            <section className="py-20 bg-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Team Information
                        </h2>
                        <p className="text-gray-400 text-lg max-w-3xl mx-auto">
                            Key team members and relevant experience, with LinkedIn links.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {teamMembers.map((member) => (
                            <div key={member.name} className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-7 hover:border-emerald-500/30 transition-colors">
                                <h3 className="text-xl font-semibold text-white mb-1">{member.name}</h3>
                                <p className="text-emerald-400 text-sm font-medium mb-4">{member.role}</p>
                                <p className="text-gray-400 mb-6">{member.experience}</p>
                                <Link
                                    href={member.linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium"
                                >
                                    <Linkedin className="w-4 h-4" />
                                    {member.linkLabel}
                                    <ExternalLink className="w-4 h-4" />
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Products */}
            <section className="py-20 bg-[#111]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Products & Development Stage
                        </h2>
                        <p className="text-gray-400 text-lg max-w-3xl mx-auto">
                            What we are building, current stage, and direct demo links.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6">
                        {products.map((product) => (
                            <div key={product.name} className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-7 hover:border-emerald-500/30 transition-colors">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xl font-semibold text-white">{product.name}</h3>
                                    <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-semibold">
                                        {product.stage}
                                    </span>
                                </div>
                                <p className="text-gray-400 mb-5">{product.description}</p>
                                <p className="text-sm text-gray-500 mb-5">{product.assets}</p>
                                <div className="flex flex-wrap gap-3">
                                    <Link
                                        href={product.demoLink}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition-colors"
                                    >
                                        <PlayCircle className="w-4 h-4" />
                                        Open Demo
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Vision 2030 */}
            <section className="py-20 bg-gradient-to-b from-[#111] to-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Vision 2030
                        </h2>
                        <p className="text-gray-400 text-lg">Our roadmap to revolutionize trading in India</p>
                    </div>

                    <div className="grid md:grid-cols-4 gap-6">
                        {[
                            { year: '2025', title: 'Beta Launch', description: '100 users testing paper trading features', color: 'emerald' },
                            { year: '2026', title: 'Series A', description: '12-18 Cr ARR with 10,000 active users', color: 'emerald' },
                            { year: '2027', title: 'Market Leadership', description: '60-90 Cr ARR serving 50,000 traders', color: 'emerald' },
                            { year: '2030', title: 'Global Expansion', description: '1 million users worldwide, 3,000-5,000 Cr ARR', color: 'emerald' }
                        ].map((milestone, index) => (
                            <div key={index} className="relative">
                                <div className="bg-[#1a1a1a] border border-gray-800 rounded-2xl p-6 hover:border-emerald-500/30 transition-colors">
                                    <div className="text-2xl font-bold text-emerald-400 mb-2">{milestone.year}</div>
                                    <h3 className="text-lg font-semibold text-white mb-2">{milestone.title}</h3>
                                    <p className="text-gray-500 text-sm">{milestone.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 bg-[#0a0a0a]">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <div className="bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 border border-emerald-500/30 rounded-3xl p-12">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Join the Trading Revolution
                        </h2>
                        <p className="text-gray-400 text-lg mb-8">
                            Together, we&apos;ll democratize algorithmic trading and empower millions of investors to trade with confidence.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition-colors"
                            >
                                Try iStocks Now
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                            <Link
                                href="/contact"
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-transparent border border-emerald-500/50 hover:border-emerald-500 text-emerald-400 font-semibold rounded-xl transition-colors"
                            >
                                Contact Us
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 border-t border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-emerald-400" />
                            </div>
                            <span className="text-xl font-bold text-white">iStocks</span>
                        </div>
                        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-500">
                            <Link href="/contact" className="hover:text-emerald-400 transition-colors">
                                Contact us
                            </Link>
                            <span className="text-gray-600" aria-hidden>
                                |
                            </span>
                            <Link href="/terms" className="hover:text-emerald-400 transition-colors">
                                Terms &amp; Conditions
                            </Link>
                            <span className="text-gray-600" aria-hidden>
                                |
                            </span>
                            <Link href="/refunds" className="hover:text-emerald-400 transition-colors">
                                Refunds &amp; Cancellations
                            </Link>
                        </nav>
                        <p className="text-gray-500 text-sm text-center md:text-right">
                            © 2025 iStocks. Democratizing algorithmic trading in India.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    )
}
