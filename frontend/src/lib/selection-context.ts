// The text on either side of a selection in a PDF page's text layer, used to
// look a selected word up together with its neighbours.

const CONTEXT_CHARS = 120
/** A longer selection is a passage to ask about, not a word to define. */
const MAX_DEFINABLE_CHARS = 80
const MAX_DEFINABLE_WORDS = 4

/** Whether a selection is short enough to be a word or a short phrase. */
export function isDefinable(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= 2 && trimmed.length <= MAX_DEFINABLE_CHARS
    && trimmed.split(/\s+/).length <= MAX_DEFINABLE_WORDS && /\p{L}/u.test(trimmed)
}

export function selectionContext(range: Range): { before: string; after: string } {
  const none = { before: '', after: '' }
  const start = range.startContainer, end = range.endContainer
  if (start.nodeType !== Node.TEXT_NODE || end.nodeType !== Node.TEXT_NODE) return none
  const layer = start.parentElement?.closest('.textLayer')
  if (!layer || !layer.contains(end)) return none
  let before = '', after = '', seen: 'before' | 'inside' | 'after' = 'before'
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // pdf.js ends each line of text with a <br>, which stands for the
      // space between the last word of one line and the first of the next.
      if ((node as Element).tagName === 'BR') {
        if (seen === 'before') before += ' '
        else if (seen === 'after') after += ' '
      }
      continue
    }
    const text = (node as Text).data
    if (node === start) { before += text.slice(0, range.startOffset); seen = 'inside' }
    if (node === end) { after += text.slice(range.endOffset); seen = 'after' }
    else if (node !== start && seen === 'before') before += text
    else if (node !== start && seen === 'after') after += text
    if (after.length >= CONTEXT_CHARS) break
  }
  return { before: before.slice(-CONTEXT_CHARS), after: after.slice(0, CONTEXT_CHARS) }
}
