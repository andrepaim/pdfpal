import type { ExtensionConnection, PairingRequest } from '../../../src/shared/extension-pairing'

async function request<T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api/extensions${path}`, { method, credentials: 'same-origin',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.detail || 'Could not reach pdfpal.')
  return data
}
export type ExtensionPackage = { version: string; filename: string; size: number; sha256: string; extension_id: string }
export const extensionApi = {
  package: () => request<ExtensionPackage>('/package'),
  connections: () => request<ExtensionConnection[]>('/connections'),
  rename: (id: string, label: string) => request(`/connections/${id}`, { label }, 'PATCH'),
  revoke: (id: string) => request(`/connections/${id}`, {}, 'DELETE'),
  pairing: (id: string) => request<PairingRequest>(`/requests/${encodeURIComponent(id)}`),
  decide: (id: string, allow: boolean) => request<PairingRequest>(`/requests/${encodeURIComponent(id)}/decision`, { allow }),
}
