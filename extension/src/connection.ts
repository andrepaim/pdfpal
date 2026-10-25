import { PAIRING_PROTOCOL, PAIRING_TTL_MS, PAIRING_POLL_MS, type PairingRequest } from '../../src/shared/extension-pairing';

export type Connection = { base: string; token: string; clientId: string; projectId: string };
type Pending = { id: string; proof: string; token: string; base: string; origin: string; expires: number };
export class BridgeError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
export function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Use a local address such as http://127.0.0.1:8200.');
  return url.origin;
}
export async function bridge<T>(base: string, path: string, body?: object, method = body ? 'POST' : 'GET', headers: Record<string,string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(base)}/api/extension${path}`, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), credentials: 'omit' });
  } catch { throw new Error('Cannot reach pdfpal. Run pdfpal serve, check the address, then Retry. Your saved connection is kept.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new BridgeError(404, 'Update and restart pdfpal to use guided connection, or use a pairing code.', 'OLD_SERVER');
  const result = await response.json();
  if (!response.ok) throw new BridgeError(response.status, result.detail || `pdfpal returned ${response.status}.`, result.code);
  return result;
}
export const api = <T>(connection: Connection, path: string, body?: object, method = body ? 'POST' : 'GET') =>
  bridge<T>(connection.base, path, body, method, { authorization: `Bearer ${connection.token}` });
const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const pendingKey = 'companionPairing';

// The panel is disposable. Every network step can be resumed from trusted local storage.
export class GuidedConnection {
  private epoch = 0;
  async pending(): Promise<Pending | undefined> { return (await chrome.storage.local.get(pendingKey))[pendingKey] as Pending | undefined; }
  stop() { this.epoch++; }
  async cancel() {
    this.stop();
    const pending = await this.pending();
    if (!pending) return 'Connection cancelled.';
    let result = 'Connection cancelled.';
    try {
      await bridge(pending.base, `/pairing-requests/${pending.id}`, undefined, 'DELETE', this.headers(pending));
    } catch (error) {
      if (error instanceof BridgeError && error.code === 'ALREADY_CLAIMED') {
        // Cancellation can race a successful claim whose response was lost.
        try { await api({ base: pending.base, token: pending.token, clientId: '', projectId: '' }, '/connection', undefined, 'DELETE'); }
        catch (revokeError) { if (!(revokeError instanceof BridgeError && revokeError.status === 401)) throw revokeError; }
      } else if (!(error instanceof BridgeError && error.status === 404)) {
        result = 'Stopped waiting locally. Server cancellation could not be confirmed; check paired connections on the Extension page when pdfpal is running.';
      }
    }
    await chrome.storage.local.remove(pendingKey);
    return result;
  }
  private headers(pending: Pending) { return { 'x-pairing-proof': pending.proof, 'x-extension-origin': pending.origin }; }
  async run(base: string, notify: (message: string) => void, openTab: boolean): Promise<Connection | undefined> {
    const epoch = ++this.epoch;
    const current = () => epoch === this.epoch;
    let pending = await this.pending();
    if (!current()) return;
    const origin = `chrome-extension://${chrome.runtime.id}`;
    if (pending && (pending.base !== base || pending.origin !== origin)) {
      throw new Error('Cancel the pending connection before changing the server address.');
    }
    if (pending) {
      // Handles a lost claim response, including after the request cleanup window.
      try {
        const status = await bridge<{ client_id: string }>(base, '/status', undefined, 'GET', { authorization: `Bearer ${pending.token}` });
        if (!current()) return;
        return this.finish(pending, status.client_id);
      } catch (error) { if (!(error instanceof BridgeError && error.status === 401)) throw error; }
      if (Date.now() >= pending.expires) {
        await chrome.storage.local.remove(pendingKey);
        throw new Error('Connection expired. Click Connect to pdfpal to start again.');
      }
    }
    const capabilities = await bridge<{ pairing_protocol: number }>(base, '/capabilities').catch(error => {
      if (error instanceof BridgeError && [401, 404].includes(error.status))
        throw new Error('Update and restart pdfpal to use guided connection, or use a pairing code.');
      throw error;
    });
    if (capabilities.pairing_protocol !== PAIRING_PROTOCOL) throw new Error('Update and restart pdfpal to use guided connection, or use a pairing code.');
    if (!current()) return;
    if (!pending) {
      pending = { id: crypto.randomUUID(), proof: secret(), token: secret(), base, origin, expires: Date.now() + PAIRING_TTL_MS };
      await chrome.storage.local.set({ [pendingKey]: pending });
    }
    if (!current()) return;
    let state = await bridge<PairingRequest>(base, '/pairing-requests', { id: pending.id }, 'POST', this.headers(pending));
    if (!current()) return;
    if (openTab && state.status === 'pending') await chrome.tabs.create({ url: `${base}/extensions/connect?request=${pending.id}` });
    while (current()) {
      if (state.status === 'approved' || state.status === 'claimed') {
        const result = await bridge<{ client_id: string }>(base, `/pairing-requests/${pending.id}/claim`, { token: pending.token }, 'POST', this.headers(pending)).catch(async error => {
          if (error instanceof BridgeError && error.status === 401 && current()) await chrome.storage.local.remove(pendingKey);
          throw error;
        });
        if (!current()) return;
        return this.finish(pending, result.client_id);
      }
      if (state.status !== 'pending' || Date.now() >= Date.parse(state.expires_at)) {
        await chrome.storage.local.remove(pendingKey);
        throw new Error(`Connection ${state.status === 'pending' ? 'expired' : state.status}. Click Connect to pdfpal to start again.`);
      }
      notify('Waiting for approval in your pdfpal tab…');
      await new Promise(resolve => setTimeout(resolve, PAIRING_POLL_MS));
      if (!current()) return;
      state = await bridge<PairingRequest>(base, `/pairing-requests/${pending.id}`, undefined, 'GET', this.headers(pending));
    }
  }
  private async finish(pending: Pending, clientId: string): Promise<Connection> {
    const connection = { base: pending.base, token: pending.token, clientId, projectId: '' };
    // Write the usable credential before removing recovery state.
    await chrome.storage.local.set({ companionConnection: connection });
    await chrome.storage.local.remove(pendingKey);
    return connection;
  }
}
