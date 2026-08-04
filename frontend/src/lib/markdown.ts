/**
 * remark-math accepts dollar-delimited math, while AI agents commonly emit
 * the equivalent LaTeX \(...\) and \[...\] delimiters. Markdown treats those
 * backslashes as escapes before remark-math sees them, so normalize only the
 * delimiters that are outside inline and fenced code.
 */
export function normalizeMarkdownMath(markdown: string): string {
  let fenceMarker: '`' | '~' | null = null
  let fenceLength = 0

  return markdown.split('\n').map(line => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const run = fence[1]!
      const marker = run[0] as '`' | '~'
      if (!fenceMarker) {
        fenceMarker = marker
        fenceLength = run.length
      } else if (marker === fenceMarker && run.length >= fenceLength) {
        fenceMarker = null
        fenceLength = 0
      }
      return line
    }

    if (fenceMarker) return line
    return normalizeLineMath(line)
  }).join('\n')
}

function normalizeLineMath(line: string): string {
  let normalized = ''
  let inlineCodeTicks = 0

  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let end = index + 1
      while (line[end] === '`') end++
      const ticks = end - index
      if (inlineCodeTicks === 0) inlineCodeTicks = ticks
      else if (inlineCodeTicks === ticks) inlineCodeTicks = 0
      normalized += line.slice(index, end)
      index = end
      continue
    }

    const delimiter = line.slice(index, index + 2)
    const escaped = index > 0 && line[index - 1] === '\\'
    if (!inlineCodeTicks && !escaped && (delimiter === '\\(' || delimiter === '\\)')) {
      normalized += '$'
      index += 2
      continue
    }
    if (!inlineCodeTicks && !escaped && (delimiter === '\\[' || delimiter === '\\]')) {
      normalized += '$$'
      index += 2
      continue
    }

    normalized += line[index]
    index++
  }

  return normalized
}
