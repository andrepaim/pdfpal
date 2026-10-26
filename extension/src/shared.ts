import { KINDLE_ORIGINS } from '../../src/shared/kindle-book';
export { KINDLE_ORIGINS };
export type BookProject = { base: string; projectId: string; bookKey: string };
export const MAX_IMAGE_LENGTH = 6_000_000;
export type Rect = { x: number; y: number; width: number; height: number };
export type Metadata = { title: string; author: string; location: string; url: string; asin: string };
export type Snapshot = {
  pageKey: string;
  metadata: Metadata;
  text?: string;
  image?: string;
  rects?: Rect[];
  viewport?: { width: number; height: number };
};
export type Draft = Snapshot & {
  id: string; tabId: number; frameId: number; capturedAt: string; method: 'text' | 'ocr';
  text: string; originalText: string; status: 'ready' | 'recognizing' | 'error';
  confidence?: number; durationMs?: number; error?: string;
};
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export const draftKey = (tabId: number) => `draft:${tabId}`;
export function bookIdentity(metadata: Metadata): string {
  const url = new URL(metadata.url);
  return `${url.origin}/${url.searchParams.get('asin') || url.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/)?.[1] || metadata.asin || url.pathname}`;
}
export function isKindle(url: string | undefined): boolean {
  try { return KINDLE_ORIGINS.includes(new URL(url!).origin); } catch { return false; }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export async function request<T>(message: object): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'The extension did not respond. Reload it and refresh the Kindle tab.');
  return reply.value;
}
export function markdown(draft: Draft): string {
  return `# ${draft.metadata.title || 'Kindle passage'}\n\n${draft.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n` +
    [draft.metadata.author, draft.metadata.location, draft.metadata.url].filter(Boolean).join(' · ') +
    `\n\nCaptured ${draft.capturedAt} · ${draft.method === 'ocr' ? 'OCR, reviewed text' : 'Selected text'}\n`;
}
