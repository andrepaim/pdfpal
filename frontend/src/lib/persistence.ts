const pending = new Set<{ save: () => unknown }>()

export function registerPendingSave(save: () => unknown): () => void {
  const entry = { save }
  pending.add(entry)
  return () => { pending.delete(entry) }
}

export async function flushPendingSaves(): Promise<void> {
  await Promise.all([...pending].map(async entry => { await entry.save() }))
}
