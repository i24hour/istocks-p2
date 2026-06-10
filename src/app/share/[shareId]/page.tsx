'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { MaybePriceRangeScreenerMarkdown } from '@/components/PriceRangeScreenerMessage'

interface SharedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface SharedChat {
  title: string
  createdAt: string
  author: string | null
  messages: SharedMessage[]
}

export default function SharePage() {
  const { shareId } = useParams<{ shareId: string }>()
  const [chat, setChat] = useState<SharedChat | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/share/${shareId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setChat(data.data)
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [shareId])

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    )
  }

  if (notFound || !chat) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4">
        <MessageSquare className="w-12 h-12 text-[var(--text-muted)]" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Conversation not found</h1>
        <p className="text-sm text-[var(--text-muted)]">This link may have been revoked or never existed.</p>
        <Link href="/database-chat" className="mt-2 px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
          Open iStocks Chat
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Conversation */}
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] truncate">{chat.title}</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {chat.author ? `by ${chat.author} · ` : ''}
            {new Date(chat.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          </p>
        </div>

        {/* Messages */}
        {chat.messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg)]">
                <svg viewBox="0 0 40 32" className="w-4 h-4" fill="none">
                  <rect x="0" y="4" width="6" height="28" rx="1" fill="#10b981" />
                  <rect x="8" y="0" width="6" height="32" rx="1" fill="#ef4444" />
                  <rect x="16" y="14" width="6" height="18" rx="1" fill="#10b981" />
                  <rect x="24" y="8" width="6" height="24" rx="1" fill="#ef4444" />
                  <rect x="32" y="2" width="6" height="30" rx="1" fill="#10b981" />
                </svg>
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-tr-sm'
                  : 'bg-[var(--card-bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-tl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <MaybePriceRangeScreenerMarkdown content={msg.content} className="text-[13px] leading-relaxed" />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5 text-right">
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {/* CTA */}
        <div className="mt-10 rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)] mb-3">This is a read-only view. Start your own conversation on iStocks.</p>
          <Link
            href="/database-chat"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <MessageSquare className="w-4 h-4" />
            Chat with iStocks AI
          </Link>
        </div>
      </main>
    </div>
  )
}
