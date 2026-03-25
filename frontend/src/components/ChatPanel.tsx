import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  pdfText: string
  pdfUrl: string
  disabled: boolean
  selectedText?: string
  onSelectedTextUsed?: () => void
  sessionId?: string | null
  initialMessages?: { role: string; content: string }[]
}

export default function ChatPanel({ pdfText, pdfUrl, disabled, selectedText, onSelectedTextUsed, sessionId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages?.map(m => ({ role: m.role as 'user'|'assistant', content: m.content })) ?? [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync messages when session is restored
  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages.map(m => ({ role: m.role as 'user'|'assistant', content: m.content })))
    }
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // When selectedText changes, pre-fill the textarea with a quote prompt
  useEffect(() => {
    if (!selectedText || disabled) return
    const quoted = `> "${selectedText}"\n\n`
    setInput(quoted)
    textareaRef.current?.focus()
    // Move cursor to end
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.value.length
        textareaRef.current.selectionEnd = textareaRef.current.value.length
      }
    }, 10)
  }, [selectedText, disabled])

  const send = async () => {
    if (!input.trim() || loading || disabled) return
    const userMsg = input.trim()
    setInput('')
    setError('')
    onSelectedTextUsed?.()

    const newHistory: Message[] = [...messages, { role: 'user', content: userMsg }]
    setMessages(newHistory)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          pdf_text: pdfText,
          pdf_url: pdfUrl,
          conversation_history: messages,
          search_web: webSearch,
          session_id: sessionId ?? null,
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

      setMessages([...newHistory, { role: 'assistant', content: assistantText }])
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      setMessages(newHistory)
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
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
              onClick={() => { setMessages([]); setError('') }}
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
          <button
            onClick={() => setWebSearch(v => !v)}
            title="Toggle web search"
            style={{
              background: webSearch ? '#1e2a1e' : '#1a1a1a',
              border: `1px solid ${webSearch ? '#4ade80' : 'var(--border)'}`,
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 12,
              color: webSearch ? '#4ade80' : '#6b7280',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            🔍 Web {webSearch ? 'ON' : 'OFF'}
          </button>
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
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Selection ready — edit the prompt below or press Enter to send
          </span>
          <button
            onClick={() => { onSelectedTextUsed?.(); setInput('') }}
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
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: msg.role === 'user' ? 'var(--accent)' : '#252525',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
            }}>
              {msg.role === 'assistant' ? (
                <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
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
            ⚠️ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || loading}
          placeholder={disabled ? 'Load a PDF first…' : 'Ask something… (Enter to send, Shift+Enter for newline)'}
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
          onClick={send}
          disabled={disabled || loading || !input.trim()}
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
