// Relative-time formatting shared across pages.

/**
 * Render an ISO timestamp as a short "time ago" label.
 *
 * Timestamps are stored via `new Date().toISOString()` (already UTC, trailing
 * `Z`). Legacy rows migrated from SQLite `datetime('now')` come as
 * `YYYY-MM-DD HH:MM:SS` with no zone — normalise those to UTC so they don't
 * shift by the local offset. Anything unparseable yields an empty string
 * rather than the old "NaNd ago".
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
  const normalized = hasZone ? iso : `${iso.replace(' ', 'T')}Z`
  const time = new Date(normalized).getTime()
  if (Number.isNaN(time)) return ''
  const m = Math.floor((Date.now() - time) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
