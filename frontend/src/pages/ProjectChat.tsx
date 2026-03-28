/**
 * ProjectChat.tsx — Cross-source chat for a project.
 * Left panel: source toggles. Right panel: full chat with all active sources in context.
 * "Save as artifact" button saves the last AI response.
 */
import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sourcesApi, artifactsApi, chatApi, type Source } from '../lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources_used?: string[]
}

export default function ProjectChat() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [sources, setSources] = useState<Source[]>([])
  const [activeSourceIds, setActiveSourceIds] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const [error, setError] = useState('')
  const [savingArtifact, setSavingArtifact] = useState(false)
  const [savedArtifact, setSavedArtifact] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!projectId) return
    // Load sources + chat history in parallel
    Promise.all([
      sourcesApi.list(projectId),
      chatApi.getProjectChat(projectId),
    ]).then(([sources, history]) => {
      setSources(sources)
      setActiveSourceIds(new Set(sources.map(x => x.id)))
      if (history.messages.length > 0) {
        setMessages(history.messages.map(m => ({
          role: m.role,
          content: m.content,
          sources_used: m.sources_used || [],
        })))
      }
    })
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const toggleSource = (id: string) => {
    setActiveSourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeSources = sources.filter(s => activeSourceIds.has(s.id))

  const send = async () => {
    if (!input.trim() || loading || activeSources.length === 0) return
    const userMsg = input.trim()
    setInput('')
    setError('')
    setSavedArtifact(false)

    const newHistory: Message[] = [...messages, { role: 'user', content: userMsg }]
    setMessages(newHistory)
    setLoading(true)

    try {
      // Build combined context from all active sources
      const contextParts = activeSources.map((s, i) =>
        `[Source ${i + 1}: ${s.title || s.url}]\n${s.pdf_text?.slice(0, 30000) || '(no text extracted)'}`
      )
      const combinedContext = contextParts.join('\n\n---\n\n')

      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          pdf_text: combinedContext,
          pdf_url: activeSources.map(s => s.url).join(', '),
          conversation_history: messages,
          search_web: webSearch,
          project_id: projectId,
          source_id: null, // project-level chat
          active_source_ids: activeSources.map(s => s.id),
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
            } catch { /* ignore parse errors */ }
          }
        }
      }

      setMessages([...newHistory, {
        role: 'assistant',
        content: assistantText,
        sources_used: activeSources.map(s => s.id),
      }])
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      setMessages(newHistory)
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')

  const saveAsArtifact = async () => {
    if (!lastAssistantMsg || !projectId) return
    setSavingArtifact(true)
    try {
      // Generate a title from the last user message
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      const title = lastUser?.content.slice(0, 60) || 'Project Chat Artifact'
      await artifactsApi.create(projectId, { title, content: lastAssistantMsg.content })
      setSavedArtifact(true)
      setTimeout(() => setSavedArtifact(false), 3000)
    } catch (e: any) {
      setError('Failed to save artifact')
    } finally {
      setSavingArtifact(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      {/* Sources panel */}
      <div style={{ width: 240, flexShrink: 0, background: '#111', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => navigate(`/projects/${projectId}`)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: 0, marginBottom: 10, display: 'block' }}>← Project</button>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Sources in context</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {sources.length === 0 && (
            <div style={{ padding: 16, color: '#4b5563', fontSize: 12, textAlign: 'center' }}>
              No sources in this project yet.
            </div>
          )}
          {sources.map(s => {
            const active = activeSourceIds.has(s.id)
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
                <div style={{ fontSize: 14, flexShrink: 0 }}>📄</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: active ? '#e5e7eb' : '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400 }}>
                    {s.title || s.url || 'Untitled'}
                  </div>
                  {s.pages > 0 && <div style={{ fontSize: 10, color: '#4b5563' }}>{s.pages}p</div>}
                </div>
                {/* Toggle */}
                <div
                  onClick={() => toggleSource(s.id)}
                  style={{
                    width: 32, height: 18, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
                    background: active ? 'var(--accent)' : '#3a3a3a',
                    position: 'relative', transition: 'background 0.15s',
                  }}
                >
                  <div style={{
                    position: 'absolute', width: 14, height: 14, background: '#fff', borderRadius: '50%',
                    top: 2, transition: 'left 0.15s',
                    left: active ? 16 : 2,
                  }} />
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: '#4b5563' }}>
          {activeSourceIds.size} of {sources.length} sources active
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '0 16px', height: 44, background: 'var(--panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14, color: '#fff' }}>💬 Project Chat</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Context: {activeSources.length} source{activeSources.length !== 1 ? 's' : ''}
          </div>
          {lastAssistantMsg && (
            <button
              onClick={saveAsArtifact}
              disabled={savingArtifact || savedArtifact}
              style={{
                background: savedArtifact ? '#14532d' : '#1e1b4b',
                border: `1px solid ${savedArtifact ? '#166534' : '#312e81'}`,
                color: savedArtifact ? '#4ade80' : '#a5b4fc',
                borderRadius: 8, padding: '4px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}
            >
              {savingArtifact ? 'Saving…' : savedArtifact ? '✓ Saved!' : '✨ Save as artifact'}
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={async () => {
              setMessages([]); setError('')
              try { if (projectId) await chatApi.clearProjectChat(projectId) } catch { /* non-fatal */ }
            }} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: '3px 8px' }}>Clear</button>
          )}
          <button
            onClick={() => setWebSearch(v => !v)}
            style={{
              background: webSearch ? '#1e2a1e' : '#1a1a1a',
              border: `1px solid ${webSearch ? '#4ade80' : 'var(--border)'}`,
              borderRadius: 6, padding: '4px 10px', fontSize: 11,
              color: webSearch ? '#4ade80' : '#6b7280', cursor: 'pointer',
            }}
          >
            🔍 Web {webSearch ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && !loading && (
            <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563', fontSize: 14 }}>
              {activeSources.length === 0
                ? 'Enable at least one source to start chatting'
                : `Ask anything across ${activeSources.length} source${activeSources.length !== 1 ? 's' : ''}…`
              }
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%' }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? 'var(--accent)' : '#252525',
                  color: msg.role === 'user' ? '#fff' : 'var(--text)',
                  fontSize: 13, lineHeight: 1.6,
                  whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
                }}>
                  {msg.role === 'assistant'
                    ? <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
                    : msg.content
                  }
                </div>
                {/* Source attribution chips */}
                {msg.role === 'assistant' && msg.sources_used && msg.sources_used.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {msg.sources_used.map(sid => {
                      const src = sources.find(s => s.id === sid)
                      return src ? (
                        <span key={sid} style={{
                          background: '#1e1b4b', border: '1px solid #312e81', color: '#818cf8',
                          borderRadius: 4, padding: '1px 7px', fontSize: 10,
                        }}>
                          📄 {(src.title || src.url || 'Source').slice(0, 30)}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '12px 16px', background: '#252525', borderRadius: '16px 16px 16px 4px', display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                <span className="spinner" /> Thinking across {activeSources.length} source{activeSources.length !== 1 ? 's' : ''}…
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: '#2d1515', color: '#f87171', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>⚠️ {error}</div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || activeSources.length === 0}
            placeholder={activeSources.length === 0 ? 'Enable at least one source…' : `Ask across ${activeSources.length} source${activeSources.length !== 1 ? 's' : ''}… (Enter to send, Shift+Enter for newline)`}
            rows={3}
            style={{
              flex: 1, background: '#0f0f0f', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px', color: 'var(--text)',
              fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              opacity: activeSources.length === 0 ? 0.5 : 1,
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || activeSources.length === 0}
            style={{
              background: loading || !input.trim() || activeSources.length === 0 ? '#2a2a2a' : 'var(--accent)',
              color: loading || !input.trim() ? '#6b7280' : '#fff',
              border: 'none', borderRadius: 10, padding: '0 16px', fontSize: 18,
              cursor: 'pointer', alignSelf: 'stretch', transition: 'background 0.15s',
            }}
          >
            {loading ? <span className="spinner" /> : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}
