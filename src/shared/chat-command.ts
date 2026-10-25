export type ChatInput = { kind: 'text' | 'visual'; question: string } | { kind: 'help'; message: string } | { kind: 'empty' }
export const VISUAL_COMMAND_HINT = 'Use /visual <concept>, or /visual alone with an attached selection.'
export const isVisualCommandPrefix = (input: string) => input.trim().startsWith('/') && '/visual'.startsWith(input.trim().toLowerCase())

export function parseChatInput(input: string, hasSelection = false): ChatInput {
  const text = input.trim()
  if (!text) return { kind: 'empty' }
  if (/^\/visual(?:\s|$)/i.test(text)) {
    const question = text.slice(7).trim()
    if (question) return { kind: 'visual', question }
    return hasSelection ? { kind: 'visual', question: 'Explain the selected passage visually.' } : { kind: 'help', message: VISUAL_COMMAND_HINT }
  }
  if (text.startsWith('/')) return { kind: 'help', message: '/visual'.startsWith(text.toLowerCase()) ? VISUAL_COMMAND_HINT : `Unknown command. ${VISUAL_COMMAND_HINT}` }
  return { kind: 'text', question: text }
}
