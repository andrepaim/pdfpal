import { type Session, deleteSession } from '../hooks/useSession'

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function SessionSidebar({ sessions, activeId, onSelect, onDelete, onNew }: Props) {
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
    onDelete(id)
  }

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      background: '#111',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 12px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
          Sessions
        </span>
        <button
          onClick={onNew}
          title="New session"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            width: 24,
            height: 24,
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >+</button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {sessions.length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: '24px 12px' }}>
            No sessions yet.<br />Load a PDF to start.
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '10px 12px',
              cursor: 'pointer',
              borderBottom: '1px solid #1a1a1a',
              background: activeId === s.id ? '#1e1e2e' : 'transparent',
              borderLeft: activeId === s.id ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 0.1s',
              position: 'relative',
            }}
            onMouseEnter={e => {
              if (activeId !== s.id) (e.currentTarget as HTMLElement).style.background = '#1a1a1a'
            }}
            onMouseLeave={e => {
              if (activeId !== s.id) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <div style={{
              fontSize: 13,
              color: activeId === s.id ? '#e5e7eb' : '#d1d5db',
              fontWeight: activeId === s.id ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingRight: 20,
            }}>
              {s.title || s.pdf_filename || 'Untitled'}
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>
              {s.pages ? `${s.pages}p · ` : ''}{timeAgo(s.accessed_at)}
            </div>

            {/* Delete button */}
            <button
              onClick={e => handleDelete(e, s.id)}
              title="Delete session"
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#4b5563',
                cursor: 'pointer',
                fontSize: 14,
                padding: 2,
                opacity: 0,
                transition: 'opacity 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
              onFocus={e => (e.currentTarget.style.opacity = '1')}
              onBlur={e => (e.currentTarget.style.opacity = '0')}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
