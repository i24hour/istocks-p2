'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import DatabaseChat from '@/components/DatabaseChat'

function DatabaseChatInner() {
  const searchParams = useSearchParams()
  const prompt = searchParams.get('prompt') || undefined
  const sessionId = searchParams.get('session') || undefined
  return <DatabaseChat initialPrompt={prompt} initialSessionId={sessionId} />
}

export default function DatabaseChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-dark-100 text-white">
          Loading Trading Agent…
        </div>
      }
    >
      <DatabaseChatInner />
    </Suspense>
  )
}
