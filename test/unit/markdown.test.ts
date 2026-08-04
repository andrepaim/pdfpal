import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMarkdownMath } from '../../frontend/src/lib/markdown.js'

test('normalizes AI-style LaTeX delimiters for remark-math', () => {
  const answer = String.raw`An offset \(B_{ij}\) is applied:

\[
\text{score}(i,j) = \text{similarity}(i,j) + \text{RPE}(\Delta x,\Delta y)
\]`

  assert.equal(normalizeMarkdownMath(answer), String.raw`An offset $B_{ij}$ is applied:

$$
\text{score}(i,j) = \text{similarity}(i,j) + \text{RPE}(\Delta x,\Delta y)
$$`)
})

test('does not alter LaTeX-like delimiters inside code', () => {
  const markdown = [
    String.raw`Keep \(x\) but not ` + '`' + String.raw`\(inlineCode\)` + '`' + '.',
    '',
    '```tex',
    String.raw`\[displayCode\]`,
    '```',
  ].join('\n')
  const expected = [
    String.raw`Keep $x$ but not ` + '`' + String.raw`\(inlineCode\)` + '`' + '.',
    '',
    '```tex',
    String.raw`\[displayCode\]`,
    '```',
  ].join('\n')

  assert.equal(normalizeMarkdownMath(markdown), expected)
})
