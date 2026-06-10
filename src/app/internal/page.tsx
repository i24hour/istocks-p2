import { redirect } from 'next/navigation'
import { getInternalSession } from '@/lib/internal-auth'
import InternalLoginForm from '@/components/internal/InternalLoginForm'

export default async function InternalLoginPage() {
    const session = await getInternalSession()
    if (session) {
        redirect('/internal/dashboard')
    }

    return <InternalLoginForm />
}
