import { useState, useEffect, useCallback } from 'react'

export interface Session {
  id: string
  title: string
  pdf_url?: string
  pdf_filename?: string
  pages: number
  created_at: string
  accessed_at: string
}

export interface SessionDetail extends Session {
  pdf_text: string
  messages: { role: string; content: string; created_at: string }[]
}

const API = '/api'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/sessions`)
      if (res.ok) setSessions(await res.json())
    } catch {}
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { sessions, refresh }
}

export async function loadSession(id: string): Promise<SessionDetail | null> {
  try {
    const res = await fetch(`${API}/sessions/${id}`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`${API}/sessions/${id}`, { method: 'DELETE' })
}
