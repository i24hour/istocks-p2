const PLACEHOLDER_TITLE = 'new chat'
const STREAM_PLACEHOLDER = '…'

/** Titles the sidebar hides — treat as unset so we derive from the first user message. */
export function isPlaceholderSessionTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim()
  if (!trimmed) return true
  return trimmed.toLowerCase() === PLACEHOLDER_TITLE
}

export function deriveSessionTitleFromUserContent(content: string, maxLen = 100): string {
  const stripped = content
    .replace(/\s*\[\d+\s+files?\s+attached\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped || stripped === STREAM_PLACEHOLDER) return ''
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen)}…` : stripped
}

export function resolveSessionListTitle(
  storedTitle: string | null | undefined,
  firstUserMessageContent: string | undefined,
  messageCount: number,
): string {
  if (!isPlaceholderSessionTitle(storedTitle) && storedTitle?.trim()) {
    const t = storedTitle.trim()
    return t.length > 50 ? `${t.slice(0, 50)}…` : t
  }

  const fromUser = deriveSessionTitleFromUserContent(firstUserMessageContent ?? '', 50)
  if (fromUser) return fromUser

  if (messageCount > 0) return 'Chat'

  return 'New Chat'
}

export function sanitizeSessionTitleOnCreate(title: string | null | undefined): string | null {
  if (isPlaceholderSessionTitle(title)) return null
  const trimmed = title?.trim()
  return trimmed || null
}
