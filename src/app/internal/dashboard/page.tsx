import { redirect } from 'next/navigation'
import { getInternalSession } from '@/lib/internal-auth'
import InternalDashboard from '@/components/internal/InternalDashboard'

export default async function InternalDashboardPage() {
    const session = await getInternalSession()
    if (!session) {
        redirect('/internal')
    }

    return <InternalDashboard adminUser={session.username} />
}
