import { useState, useEffect } from 'react'

export interface AgentInfo {
  id: string
  label: string
  available: boolean
}

const STORAGE_KEY = 'pdfpal.agent'

/**
 * Loads the server's agent list (GET /api/agents) and the user's persisted
 * selection. The chosen agent is stored in localStorage so it survives across
 * the per-source and project-chat panels. Falls back to the server default
 * when the stored choice is no longer available.
 */
export function useAgent() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [agent, setAgent] = useState<string>('')

  useEffect(() => {
    fetch('/api/agents')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return
        const all: AgentInfo[] = data.agents || []
        setAgents(all)
        const stored = localStorage.getItem(STORAGE_KEY)
        const availableIds = all.filter(a => a.available).map(a => a.id)
        const effective =
          stored && availableIds.includes(stored) ? stored : data.default
        localStorage.setItem(STORAGE_KEY, effective)
        setAgent(effective)
      })
      .catch(() => {})
  }, [])

  const selectAgent = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setAgent(id)
  }

  const available = agents.filter(a => a.available)

  return { agent, setAgent: selectAgent, agents: available }
}
