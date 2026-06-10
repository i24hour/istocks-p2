'use client'

import { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-2.5 last:mb-0 whitespace-pre-wrap leading-[1.55] text-[var(--text-primary)]">{children}</p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic text-[var(--text-secondary)]">{children}</em>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 space-y-1.5 marker:text-[var(--text-muted)] text-[var(--text-primary)]">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 space-y-1.5 marker:text-[var(--text-muted)] text-[var(--text-primary)]">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="whitespace-pre-wrap leading-[1.5] pl-0.5">{children}</li>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="text-lg font-semibold mb-2 mt-1 text-[var(--text-primary)] tracking-tight">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-base font-semibold mb-2 mt-3 text-[var(--text-primary)] tracking-tight border-b border-[var(--border-subtle)] pb-1.5">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-sm font-semibold mb-1.5 mt-2 text-[var(--text-primary)]">{children}</h3>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="px-1.5 py-0.5 rounded-md text-[12px] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]">{children}</code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-xl p-3 text-[12px] font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]">{children}</pre>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 break-all decoration-[var(--accent)]/40 hover:decoration-[var(--accent)]"
      style={{ color: 'var(--accent)' }}
    >
      {children}
    </a>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-3 w-full overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <table className="w-full text-left text-[12px] sm:text-[13px] border-collapse min-w-[260px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="border-b border-[var(--border-subtle)] last:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="px-2.5 py-2 font-semibold text-[11px] sm:text-xs uppercase tracking-wide whitespace-nowrap">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="px-2.5 py-2 align-top text-[var(--text-primary)] tabular-nums">{children}</td>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => <blockquote>{children}</blockquote>,
  hr: () => <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />,
}

export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`database-chat-markdown ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
