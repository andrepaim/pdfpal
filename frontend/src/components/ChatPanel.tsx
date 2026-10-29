import AIRecovery from './AIRecovery'
import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { chatApi } from '../lib/api'
import { useAgent } from '../hooks/useAgent'
import AgentSelect from './AgentSelect'
import Markdown from './Markdown'
import VisualExplanation from './VisualExplanation'
import { startWebVisual, webVisualTransport } from '../lib/visual-api'
import { isVisualCommandPrefix, parseChatInput, type ChatInput } from '../../../src/shared/chat-command'
import ChatCommandHint from './ChatCommandHint'

interface Message {
  role: 'user' | 'assistant'
  content: string
  visual_id?: string | null
}

interface Props {
  pdfText: string
  pdfUrl: string
  disabled: boolean
  selectedText?: string
  onSelectedTextUsed?: () => void
  visualSelectionRequest?: { id: string; text: string; scope: string } | null
  onVisualSelectionHandled?: () => void
  // v2
  projectId?: string | null
  sourceId?: string | null
  // v1 legacy
  sessionId?: string | null
  initialMessages?: { role: string; content: string }[]
}

export default function ChatPanel({ pdfText, pdfUrl, disabled, selectedText, onSelectedTextUsed, visualSelectionRequest, onVisualSelectionHandled, projectId, sourceId, sessionId, initialMessages }: Props) {
  // Retained in the component contract for older callers; context is now
  // loaded by the server-side ChatService from source IDs.
  void pdfText
  void pdfUrl
  const [messages, setMessages] = useState<Message[]>(initialMessages?.map(m => ({ role: m.role as 'user'|'assistant', content: m.content })) ?? [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const handledVisualRequest = useRef('')
  const scopeRef = useRef('')
  scopeRef.current = `${projectId}:${sourceId}`
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { agent, setAgent, agents: agentOptions } = useAgent()

  // Load chat history when source changes
  useEffect(() => {
    let active = true
    setMessages([])
    setHistoryLoading(true)
    setLoading(false); setError('')
    if (projectId && sourceId) {
      fetch(`/api/projects/${projectId}/sources/${sourceId}/chat`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { messages: [] })
        .then(data => {
          if (active && data.messages?.length > 0) {
            setMessages(data.messages.map((m: { role: string; content: string; visual_id?: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content, visual_id: m.visual_id,
            })))
          }
        })
        .catch(() => {})
        .finally(() => { if (active) setHistoryLoading(false) })
    } else setHistoryLoading(false)
    return () => { active = false }
  }, [projectId, sourceId, sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Keep the selection attached separately so a slash command starts the input.
  useEffect(() => {
    if (!selectedText || disabled) return
    textareaRef.current?.focus()
    // Move cursor to end
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.value.length
        textareaRef.current.selectionEnd = textareaRef.current.value.length
      }
    }, 10)
  }, [selectedText, disabled])

  const send = async (override?: Extract<ChatInput, { kind: 'text' | 'visual' }>, selection = selectedText) => {
    if (loading || historyLoading || disabled) return
    const command = override || parseChatInput(input, !!selection)
    if (command.kind === 'help' || command.kind === 'empty') { textareaRef.current?.focus(); return }
    const asVisual = command.kind === 'visual'
    const userMsg = !asVisual && selection ? `${command.question}\n\n${selection.split('\n').map(line => `> ${line}`).join('\n')}` : command.question
    const scope = scopeRef.current
    setInput('')
    setError('')

    const newHistory: Message[] = [...messages, { role: 'user', content: userMsg }]
    setMessages(newHistory)
    setLoading(true)

    try {
      if (asVisual && projectId) {
        const visual = await startWebVisual(projectId, { question: userMsg, ...(sourceId ? { source_id: sourceId } : {}),
          ...(selection ? { selection } : {}), ...(agent ? { agent } : {}) })
        if (scope === scopeRef.current) { setMessages([...newHistory, { role: 'assistant', content: '', visual_id: visual.id }]); onSelectedTextUsed?.() }
        return
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          agent,
          project_id: projectId ?? null,
          source_id: sourceId ?? null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Chat request failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            if (payload === '[DONE]') break
            try {
              const parsed = JSON.parse(payload)
              if (parsed.error) throw new Error(parsed.error)
              if (parsed.text) assistantText = parsed.text
            } catch (e: any) {
              // ignore JSON parse errors for [DONE] and other non-JSON payloads
            }
          }
        }
      }

      if (scope === scopeRef.current) { setMessages([...newHistory, { role: 'assistant', content: assistantText }]); onSelectedTextUsed?.() }
    } catch (e: any) {
      if (scope === scopeRef.current) { setError(e.message || 'Something went wrong'); setMessages(newHistory); setInput(asVisual ? `/visual ${command.question}` : command.question) }
    } finally {
      if (scope === scopeRef.current) { setLoading(false); textareaRef.current?.focus() }
    }
  }

  useEffect(() => {
    if (!visualSelectionRequest || visualSelectionRequest.scope !== scopeRef.current || !agent || loading || historyLoading || disabled || handledVisualRequest.current === visualSelectionRequest.id) return
    handledVisualRequest.current = visualSelectionRequest.id
    onVisualSelectionHandled?.()
    void send({ kind: 'visual', question: 'Explain the selected passage visually.' }, visualSelectionRequest.text)
  }, [visualSelectionRequest, agent, loading, historyLoading, disabled])

  const chooseVisual = () => { setInput('/visual '); textareaRef.current?.focus() }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Tab' && !e.shiftKey && isVisualCommandPrefix(input)) { e.preventDefault(); chooseVisual(); return }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--panel)' }}>
      {/* Chat header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>AI Chat</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {messages.length > 0 && (
            <button
              onClick={async () => {
                setMessages([]); setError('')
                try {
                  if (projectId && sourceId) await chatApi.clearSourceChat(projectId, sourceId)
                } catch { /* non-fatal */ }
              }}
              title="Clear conversation"
              style={{
                background: 'none', border: 'none', color: '#6b7280',
                cursor: 'pointer', fontSize: 12, padding: '3px 8px',
                borderRadius: 5, transition: 'color 0.15s',
              }}
            >
              Clear
            </button>
          )}
          <AgentSelect agent={agent} setAgent={setAgent} agents={agentOptions} />
        </div>
      </div>

      {/* Selection hint banner */}
      {selectedText && !disabled && (
        <div style={{
          padding: '8px 14px',
          background: '#1e1e2e',
          borderBottom: '1px solid #2a2a4a',
          fontSize: 12,
          color: '#818cf8',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <span>✏️</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span title={selectedText} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedText}</span>
            <span style={{ fontSize: 11 }}>Selection attached — ask a question or type /visual</span>
          </span>
          <button
            onClick={() => onSelectedTextUsed?.()}
            aria-label="Remove selection"
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}
          >✕</button>
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ color: '#4b5563', fontSize: 14, textAlign: 'center', marginTop: 40 }}>
            {disabled
              ? 'Load a PDF to start chatting'
              : 'Ask anything about the document…'}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: msg.visual_id ? '100%' : '85%', width: msg.visual_id ? '100%' : undefined, minWidth: 0,
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: msg.role === 'user' ? 'var(--accent)' : '#252525',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
            }}>
              {msg.role === 'assistant' ? (
                msg.visual_id && projectId ? <VisualExplanation key={msg.visual_id} id={msg.visual_id} transport={webVisualTransport(projectId)}
                  onFollowUp={question => { setInput(question); textareaRef.current?.focus() }} />
                : <Markdown>{msg.content}</Markdown>
              ) : msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '12px 16px', background: '#252525',
              borderRadius: '16px 16px 16px 4px',
              display: 'flex', alignItems: 'center', gap: 8,
              color: '#6b7280', fontSize: 14,
            }}>
              <span className="spinner" /> Thinking…
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: '#2d1515', color: '#f87171', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>
            ⚠️ {error}<AIRecovery />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {!loading && <ChatCommandHint input={input} hasSelection={!!selectedText} onChoose={chooseVisual} />}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || loading || historyLoading}
          placeholder={disabled ? 'Load a PDF first…' : selectedText ? 'Ask about the selection, or type /visual…' : 'Ask a question, or type /visual…'}
          rows={3}
          style={{
            flex: 1,
            background: '#0f0f0f',
            border: `1px solid ${selectedText && !disabled ? '#4f46e5' : 'var(--border)'}`,
            borderRadius: 10,
            padding: '10px 14px',
            color: 'var(--text)',
            fontSize: 14,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            opacity: disabled ? 0.5 : 1,
            transition: 'border-color 0.2s',
          }}
        />
        <button
          onClick={() => send()}
          disabled={disabled || loading || historyLoading || !input.trim()}
          style={{
            background: disabled || !input.trim() ? '#2a2a2a' : 'var(--accent)',
            color: disabled || !input.trim() ? '#6b7280' : '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '0 16px',
            fontSize: 18,
            cursor: disabled || loading || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            alignSelf: 'stretch',
          }}
        >
          {loading ? <span className="spinner" /> : '↑'}
        </button>
      </div>
    </div>
  )
}
