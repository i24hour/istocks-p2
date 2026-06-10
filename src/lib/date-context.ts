/**
 * Centralized "today's date" injector for all LLM prompts.
 * Prevents models from hallucinating stale years (e.g. 2024, 2025)
 * when the user asks for "latest", "today", "recent" data.
 */

export function getDateContext(): string {
    const now = new Date()
    // Force IST (Asia/Kolkata) so Indian market context is clear
    const istFormatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
    const dateStr = istFormatter.format(now)

    return (
        `[TODAY'S DATE: ${dateStr} IST]\n` +
        `CRITICAL: Always treat the date above as "today". ` +
        `When the user asks for "latest", "current", "today", or "recent" data, ` +
        `use this date as your reference point. ` +
        `If you do not have real-time data for this exact date, say so — ` +
        `do NOT assume the year is 2024, 2025, or any other past date.\n`
    )
}
