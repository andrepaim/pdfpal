interface AgentOption {
  id: string
  label: string
}

interface Props {
  agent: string
  setAgent: (id: string) => void
  agents: AgentOption[]
}

/** Compact agent selector styled to match the Web ON/OFF toggle next to it. */
export default function AgentSelect({ agent, setAgent, agents }: Props) {
  if (agents.length === 0) return null
  return (
    <select
      value={agent}
      onChange={e => setAgent(e.target.value)}
      title="Chat agent"
      style={{
        background: '#1a1a1a',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 12,
        color: '#a5b4fc',
        cursor: 'pointer',
        outline: 'none',
        fontFamily: 'inherit',
      }}
    >
      {agents.map(a => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  )
}
