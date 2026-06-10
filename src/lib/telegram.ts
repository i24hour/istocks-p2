/**
 * Telegram Bot API helpers
 * Handles sending messages, parsing updates, and inline keyboards.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot'

function getBotToken(): string {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
    return token
}

// ── Types ───────────────────────────────────────────────────────────

export interface TelegramUpdate {
    update_id: number
    message?: TelegramMessage
    callback_query?: CallbackQuery
}

export interface TelegramMessage {
    message_id: number
    from?: TelegramUser
    chat: TelegramChat
    date: number
    text?: string
    entities?: MessageEntity[]
}

export interface TelegramUser {
    id: number
    is_bot: boolean
    first_name: string
    last_name?: string
    username?: string
    language_code?: string
}

export interface TelegramChat {
    id: number
    type: 'private' | 'group' | 'supergroup' | 'channel'
    title?: string
    username?: string
    first_name?: string
    last_name?: string
}

export interface CallbackQuery {
    id: string
    from: TelegramUser
    message?: TelegramMessage
    data?: string
}

export interface MessageEntity {
    type: string
    offset: number
    length: number
}

export interface InlineKeyboardButton {
    text: string
    callback_data?: string
    url?: string
}

// ── API Methods ─────────────────────────────────────────────────────

async function callTelegram(method: string, body: Record<string, any>): Promise<any> {
    const token = getBotToken()
    const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.ok) {
        console.error(`❌ Telegram API error (${method}):`, json)
    }
    return json
}

/**
 * Send a text message. Supports Markdown (MarkdownV2 is too strict, use HTML or plain Markdown).
 */
export async function sendMessage(
    chatId: number,
    text: string,
    options?: {
        replyToMessageId?: number
        inlineKeyboard?: InlineKeyboardButton[][]
        parseMode?: 'Markdown' | 'HTML'
    }
): Promise<any> {
    // Telegram has a 4096 char limit per message. Split if needed.
    const MAX_LEN = 4000
    const chunks: string[] = []
    let remaining = text
    while (remaining.length > MAX_LEN) {
        // Try to split at a newline near the limit
        let splitAt = remaining.lastIndexOf('\n', MAX_LEN)
        if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN
        chunks.push(remaining.slice(0, splitAt))
        remaining = remaining.slice(splitAt)
    }
    chunks.push(remaining)

    let lastResult: any = null
    for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1
        const body: Record<string, any> = {
            chat_id: chatId,
            text: chunks[i],
        }
        if (options?.parseMode) body.parse_mode = options.parseMode
        if (options?.replyToMessageId && i === 0) body.reply_to_message_id = options.replyToMessageId
        // Only attach keyboard to the last chunk
        if (isLast && options?.inlineKeyboard) {
            body.reply_markup = { inline_keyboard: options.inlineKeyboard }
        }
        lastResult = await callTelegram('sendMessage', body)
    }
    return lastResult
}

/**
 * Send a "typing..." indicator while processing
 */
export async function sendChatAction(chatId: number, action: 'typing' | 'upload_photo' = 'typing'): Promise<void> {
    await callTelegram('sendChatAction', { chat_id: chatId, action })
}

/**
 * Answer a callback query (when user taps an inline button)
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await callTelegram('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: text || '',
    })
}

/**
 * Edit an existing message (useful for updating "Thinking..." → final answer)
 */
export async function editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options?: {
        inlineKeyboard?: InlineKeyboardButton[][]
        parseMode?: 'Markdown' | 'HTML'
    }
): Promise<any> {
    const body: Record<string, any> = {
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, 4000),
    }
    if (options?.parseMode) body.parse_mode = options.parseMode
    // Always set reply_markup — pass empty to remove existing inline keyboard
    body.reply_markup = options?.inlineKeyboard
        ? { inline_keyboard: options.inlineKeyboard }
        : {}
    return callTelegram('editMessageText', body)
}

/**
 * Set webhook URL for the bot
 */
export async function setWebhook(url: string): Promise<any> {
    return callTelegram('setWebhook', {
        url,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 40,
    })
}

/**
 * Delete webhook
 */
export async function deleteWebhook(): Promise<any> {
    return callTelegram('deleteWebhook', { drop_pending_updates: true })
}

/**
 * Get current webhook info
 */
export async function getWebhookInfo(): Promise<any> {
    return callTelegram('getWebhookInfo', {})
}

/**
 * Extract command from a message (e.g. "/start" → "start", "/price WIPRO" → "price")
 */
export function parseCommand(message: TelegramMessage): { command: string; args: string } | null {
    if (!message.text) return null
    const text = message.text.trim()
    if (!text.startsWith('/')) return null
    const parts = text.split(/\s+/)
    const cmd = parts[0].replace('/', '').replace(/@.*$/, '').toLowerCase() // strip @botname
    const args = parts.slice(1).join(' ')
    return { command: cmd, args }
}
