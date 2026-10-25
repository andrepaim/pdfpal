// Public wire contract. Secrets are never part of the approval URL or public metadata.
export const EXTENSION_ID = 'billjanehfdgcakkbbefbjobocjlinen'
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`
export const PAIRING_PROTOCOL = 1
export const PAIRING_TTL_MS = 5 * 60_000
export const PAIRING_POLL_MS = 1500
export type PairingState = 'pending' | 'approved' | 'claimed' | 'denied' | 'cancelled' | 'expired'
export interface PairingRequest {
  id: string
  origin: string
  status: PairingState
  created_at: string
  expires_at: string
}
export interface ExtensionConnection {
  id: string
  origin: string
  label: string | null
  created_at: string
  revoked_at: string | null
}
