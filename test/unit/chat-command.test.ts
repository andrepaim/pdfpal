import test from 'node:test'
import assert from 'node:assert/strict'
import { isVisualCommandPrefix, parseChatInput } from '../../src/shared/chat-command.js'

test('visual commands strip only the leading command and retain the requested topic', () => {
  assert.deepEqual(parseChatInput(' /VISUAL  how attention works\nwith examples '), { kind: 'visual', question: 'how attention works\nwith examples' })
  assert.deepEqual(parseChatInput('/visual gradients', true), { kind: 'visual', question: 'gradients' })
  assert.deepEqual(parseChatInput('Explain /visual to me'), { kind: 'text', question: 'Explain /visual to me' })
  assert.deepEqual(parseChatInput('https://example.com/paper'), { kind: 'text', question: 'https://example.com/paper' })
})

test('a bare command needs a topic or attached selection and never becomes a normal agent question', () => {
  assert.deepEqual(parseChatInput('/visual', true), { kind: 'visual', question: 'Explain the selected passage visually.' })
  const help = parseChatInput('/visual')
  assert.equal(help.kind, 'help')
  if (help.kind === 'help') assert.match(help.message, /attached selection/)
  assert.equal(parseChatInput('/').kind, 'help')
  assert.equal(parseChatInput('/vis').kind, 'help')
  assert.equal(parseChatInput('/visuality').kind, 'help')
  assert.equal(parseChatInput('/unknown topic').kind, 'help')
  assert.equal(parseChatInput('  ').kind, 'empty')
  assert.equal(isVisualCommandPrefix('/vis'), true)
  assert.equal(isVisualCommandPrefix('/VISUAL'), true)
  assert.equal(isVisualCommandPrefix('/visual topic'), false)
  assert.equal(isVisualCommandPrefix('ordinary question'), false)
})
