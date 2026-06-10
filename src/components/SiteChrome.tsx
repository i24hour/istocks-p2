'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'
import { SiteFooter } from '@/components/SiteFooter'

export function SiteChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isInternal = pathname?.startsWith('/internal')

    if (isInternal) {
        return <>{children}</>
    }

    return (
        <>
            <Header />
            {children}
            <SiteFooter />
        </>
    )
}
