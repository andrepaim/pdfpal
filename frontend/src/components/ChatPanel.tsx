import AIRecovery from './AIRecovery'
import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { chatApi } from '../lib/api'
import { useAgent } from '../hooks/useAgent'
import { hasAgentModelPreference, isCustomAgentModel, loadChatGPTModels, MAX_AGENT_MODEL_LENGTH, useAgentModels } from '../hooks/useAgentModels'
import { useChatModelPreference } from '../lib/chat-model-preferences'
import AgentSelect from './AgentSelect'
import ModelSelect from './ModelSelect'
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

export type SelectionExplanationRequest = {
  id: string
  kind: 'term' | 'passage' | 'visual'
  text: string
  page?: number
  scope: string
}

const selectionQuestions: Record<SelectionExplanationRequest['kind'], string> = {
  term: 'Explain this term in the context of the passage.',
  passage: 'Explain this passage in plain language. Use the surrounding page for context and clarify any technical terms needed to understand it.',
  visual: 'Explain the selected passage visually.',
}

interface Props {
  pdfText: string
  pdfUrl: string
  disabled: boolean
  selectedText?: string
  /** PDF page the selection came from, sent so the server can include that page. */
  selectedPage?: number | null
  onSelectedTextUsed?: () => void
  selectionExplanation?: SelectionExplanationRequest | null
  onSelectionExplanationHandled?: () => void
  // v2
  projectId?: string | null
  sourceId?: string | null
  // v1 legacy
  sessionId?: string | null
  initialMessages?: { role: string; content: string }[]
}

export default function ChatPanel({ pdfText, pdfUrl, disabled, selectedText, selectedPage, onSelectedTextUsed, selectionExplanation, onSelectionExplanationHandled, projectId, sourceId, sessionId, initialMessages }: Props) {
  // Retained in the component contract for older callers; context is now
  // loaded by the server-side ChatService from source IDs.
  void pdfText
  void pdfUrl
  const [messages, setMessages] = useState<Message[]>(initialMessages?.map(m => ({ role: m.role as 'user'|'assistant', content: m.content })) ?? [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [partial, setPartial] = useState('')
  const [recovered, setRecovered] = useState<{id:string;question:string;answer:string;status:string}[]>([])
  const [error, setError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [modelEditor, setModelEditor] = useState<{ key: string; draft: string }>()
  const handledExplanation = useRef('')
  const scopeRef = useRef('')
  scopeRef.current = `${projectId}:${sourceId}`
  const mounted = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { agent, setAgent, agents: agentOptions, loading: agentLoading } = useAgent()
  const agentRef = useRef(agent)
  agentRef.current = agent
  const customModels = hasAgentModelPreference(agent)
  const directChatGPT = agent === 'chatgpt' && !!window.pdfpalDesktop?.chatgpt
  const { models, model: defaultModel, accountId, loading: modelsLoading, refresh } = useAgentModels(agent, !!projectId && !!sourceId)
  const modelPreference = useChatModelPreference(projectId, sourceId, agent, accountId)
  const preferenceKey = modelPreference.key
  const overrideAvailable = customModels || (directChatGPT && models.some(model => model.id === modelPreference.value))
  const override = overrideAvailable ? modelPreference.value : ''
  const defaultModelName = models.find(model => model.id === defaultModel)?.name ?? defaultModel
  const editor = modelEditor?.key === preferenceKey ? modelEditor : undefined
  const customModel = editor?.draft.trim() ?? ''
  const scopeLoading = agentLoading || modelPreference.loading || (directChatGPT && modelsLoading)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  function chooseModel(model: string) {
    modelPreference.setValue(model)
    setModelEditor(undefined)
  }

  useEffect(() => {
    if (agent !== 'chatgpt' || !projectId) { setRecovered([]); return }
    let active=true
    void fetch(`/api/ai-jobs?project_id=${encodeURIComponent(projectId)}${sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''}`).then(r=>r.ok?r.json():[]).then(jobs=>{if(active)setRecovered(jobs.filter((j:{status:string})=>j.status!=='complete'))}).catch(()=>{})
    return()=>{active=false}
  }, [agent,projectId,sourceId])
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

  const send = async (forcedInput?: Extract<ChatInput, { kind: 'text' | 'visual' }>, selection = selectedText, selectionPage = selectedPage) => {
    if (loading || historyLoading || scopeLoading || disabled) return
    const command = forcedInput || parseChatInput(input, !!selection)
    if (command.kind === 'help' || command.kind === 'empty') { textareaRef.current?.focus(); return }
    const asVisual = command.kind === 'visual'
    const userMsg = !asVisual && selection ? `${command.question}\n\n${selection.split('\n').map(line => `> ${line}`).join('\n')}` : command.question
    const scope = scopeRef.current
    const currentScope = () => mounted.current && scope === scopeRef.current
    if (!forcedInput) setInput('')
    setError('')

    const newHistory: Message[] = [...messages, { role: 'user', content: userMsg }]
    setPartial(''); setLoading(true)

    try {
      if (directChatGPT && override) {
        const active = await loadChatGPTModels().catch(() => undefined)
        if (!currentScope()) return
        if (agentRef.current !== agent) throw new Error('The assistant changed. Check the conversation model and send again.')
        if (!active || active.accountId !== accountId || !active.models.some(option => option.id === override)) {
          refresh()
          throw new Error('Could not confirm the selected model for your active ChatGPT account. Check the conversation model and send again.')
        }
      }
      setMessages(newHistory)
      const model = override ? { model: override } : {}
      if (asVisual && projectId) {
        const visual = await startWebVisual(projectId, { question: userMsg, ...(sourceId ? { source_id: sourceId } : {}),
          ...(selection ? { selection } : {}), ...(selection && sourceId && selectionPage ? { selection_page: selectionPage } : {}),
          ...(agent ? { agent } : {}), ...model })
        if (currentScope()) { setMessages([...newHistory, { role: 'assistant', content: '', visual_id: visual.id }]); onSelectedTextUsed?.() }
        return
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          ...(agent ? { agent } : {}),
          ...model,
          project_id: projectId ?? null,
          source_id: sourceId ?? null,
          ...(selection && selectionPage ? { selection_page: selectionPage } : {}),
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
      let streamCompleted = false, streamError = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            if (payload === '[DONE]') { streamCompleted = true; break }
            try {
              const parsed = JSON.parse(payload)
              if (parsed.error) { streamError = parsed.error; if (currentScope()) setError(parsed.error); continue }
              if (parsed.text) { assistantText = parsed.text; if (currentScope()) setPartial(parsed.text) }
            } catch (e: any) {
              // ignore JSON parse errors for [DONE] and other non-JSON payloads
            }
          }
        }
      }

      if (!streamCompleted || streamError) throw new Error(streamError || 'The answer was interrupted. Partial text is saved on this device.')
      if (currentScope()) { setMessages([...newHistory, { role: 'assistant', content: assistantText }]); onSelectedTextUsed?.() }
    } catch (e: any) {
      if (currentScope()) { setError(e.message || 'Something went wrong'); setInput(draft => draft || (asVisual ? `/visual ${command.question}` : command.question)) }
    } finally {
      if (currentScope()) { setLoading(false); textareaRef.current?.focus() }
    }
  }

  useEffect(() => {
    if (!selectionExplanation || selectionExplanation.scope !== scopeRef.current || !agent || loading || historyLoading || scopeLoading || disabled || handledExplanation.current === selectionExplanation.id) return
    const { id, kind, text, page } = selectionExplanation
    handledExplanation.current = id
    onSelectionExplanationHandled?.()
    const question = selectionQuestions[kind]
    void send({ kind: kind === 'visual' ? 'visual' : 'text', question }, text, page ?? null)
  }, [selectionExplanation, agent, loading, historyLoading, scopeLoading, disabled])

  const chooseVisual = () => { setInput('/visual '); textareaRef.current?.focus() }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Tab' && !e.shiftKey && isVisualCommandPrefix(input)) { e.preventDefault(); chooseVisual(); return }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const canSend = !disabled && !loading && !historyLoading && !scopeLoading && !!input.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--panel)' }}>
      {/* Chat header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>AI Chat</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minWidth: 0, gap: 8, fontSize: 12 }}>
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
          <AgentSelect agent={agent} setAgent={value => { setModelEditor(undefined); setAgent(value) }} agents={agentOptions} />
          {(customModels || directChatGPT) && projectId && sourceId && <ModelSelect
            label="Conversation model" value={override} models={models}
            defaultOption={defaultModelName ? `Use default (${defaultModelName})` : 'Use default'}
            onChange={chooseModel} allowUnlisted={customModels}
            disabled={!preferenceKey || (directChatGPT && !models.length)}
            onCustom={customModels && preferenceKey ? () => setModelEditor({ key: preferenceKey, draft: override }) : undefined}
          />}
        </div>
        {editor && <form onSubmit={event => {
          event.preventDefault()
          if (isCustomAgentModel(customModel)) chooseModel(customModel)
        }} style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}>
          <input aria-label="Conversation model ID" placeholder="Model ID" className="agent-model-select"
            autoFocus maxLength={MAX_AGENT_MODEL_LENGTH} value={editor.draft}
            onChange={event => setModelEditor({ key: editor.key, draft: event.target.value })}
            style={{ flex: '1 1 130px' }} />
          <button type="submit" className="agent-model-select" disabled={!isCustomAgentModel(customModel)}>Apply model</button>
          <button type="button" className="agent-model-select" onClick={() => setModelEditor(undefined)}>Cancel</button>
        </form>}
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

        {recovered.map(job => <details key={job.id}><summary>Saved {job.status} answer · {job.question.slice(0,100)}</summary><p style={{whiteSpace:'pre-wrap'}}>{job.answer}</p><button onClick={()=>setInput(job.question)}>Use this question again</button></details>)}
        {loading && partial && <div style={{whiteSpace:'pre-wrap',padding:16}}>{partial}</div>}
        {loading && agent === 'chatgpt' && window.pdfpalDesktop?.chatgpt && <button onClick={()=>void window.pdfpalDesktop!.chatgpt!('stop')}>Stop ChatGPT answers</button>}
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
          disabled={!canSend}
          style={{
            background: canSend ? 'var(--accent)' : '#2a2a2a',
            color: canSend ? '#fff' : '#6b7280',
            border: 'none',
            borderRadius: 10,
            padding: '0 16px',
            fontSize: 18,
            cursor: canSend ? 'pointer' : 'not-allowed',
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
