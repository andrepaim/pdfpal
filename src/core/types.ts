export interface Project {
  id: string
  title: string
  description: string
  created_at: string
  accessed_at: string
  source_count?: number
  note_count?: number
  chat_count?: number
}

export interface Source {
  id: string
  project_id: string
  type: 'pdf' | 'url' | 'text'
  url: string | null
  title: string | null
  pdf_text: string | null
  pages: number
  created_at: string
  accessed_at: string
  original_location?: string | null
  local_path?: string | null
  media_type?: string | null
  byte_size?: number | null
  content_hash?: string | null
  collection_id?: string | null
}

export interface Note {
  id: string
  project_id: string
  source_id: string | null
  title: string
  content: string
  created_at: string
  updated_at: string
}

export interface Passage {
  source_id: string
  source_title: string
  page_number: number
  content: string
  score: number
}

export interface AskResult {
  answer: string
  project: Pick<Project, 'id' | 'title'>
  sources: Array<{ id: string; title: string; pages: number[] }>
  chat_session_id: string
}

export class PdfpalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 1,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'PdfpalError'
  }
}
