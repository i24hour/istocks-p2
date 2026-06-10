import Loader from '@/components/Loader'

export default function Loading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300">
            <main className="max-w-7xl mx-auto px-4 py-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column Skeleton */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Header Skeleton */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 animate-pulse">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 bg-white/5 rounded-2xl"></div>
                                    <div className="space-y-2">
                                        <div className="h-8 w-48 bg-white/5 rounded-lg"></div>
                                        <div className="h-4 w-24 bg-white/5 rounded-lg"></div>
                                    </div>
                                </div>
                            </div>
                            <div className="h-10 w-32 bg-white/5 rounded-lg mb-6"></div>
                            <div className="grid grid-cols-4 gap-4 pt-4 border-t border-white/10">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="space-y-2">
                                        <div className="h-3 w-12 bg-white/5 rounded"></div>
                                        <div className="h-6 w-20 bg-white/5 rounded"></div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Chart Skeleton */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 h-[400px] flex items-center justify-center">
                            <Loader size={40} />
                        </div>

                        {/* Insights Skeleton */}
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl p-6 border border-white/10 h-64 animate-pulse">
                            <div className="h-6 w-48 bg-white/5 rounded mb-4"></div>
                            <div className="space-y-3">
                                <div className="h-4 w-full bg-white/5 rounded"></div>
                                <div className="h-4 w-5/6 bg-white/5 rounded"></div>
                                <div className="h-4 w-4/6 bg-white/5 rounded"></div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column Skeleton */}
                    <div className="hidden lg:block lg:col-span-1">
                        <div className="bg-dark-100/60 backdrop-blur-xl rounded-2xl border border-white/10 h-[600px] animate-pulse">
                            <div className="p-4 border-b border-white/10">
                                <div className="h-6 w-32 bg-white/5 rounded"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
