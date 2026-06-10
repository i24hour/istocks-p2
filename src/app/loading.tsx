import Loader from '@/components/Loader'

export default function Loading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-dark-300 via-dark-100 to-dark-300 flex items-center justify-center">
            <Loader size={64} />
        </div>
    )
}
