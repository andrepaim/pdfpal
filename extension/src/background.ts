import { draftKey, errorMessage, isKindle, MAX_IMAGE_LENGTH, type Draft, type Reply, type Snapshot } from './shared';

// Open from the action listener so the click also grants activeTab for screenshots.
chrome.action.onClicked.addListener(tab => {
  if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
});
// Only extension pages can read drafts; the Kindle page receives no saved content.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const operations = new Map<number, Promise<unknown>>();
function serialize<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const next = (operations.get(tabId) ?? Promise.resolve()).catch(() => {}).then(operation);
  operations.set(tabId, next);
  void next.finally(() => { if (operations.get(tabId) === next) operations.delete(tabId); }).catch(() => {});
  return next;
}
async function readDraft(tabId: number): Promise<Draft | undefined> {
  return (await chrome.storage.session.get(draftKey(tabId)))[draftKey(tabId)] as Draft | undefined;
}
async function reader(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!isKindle(tab.url)) throw new Error('Open a book in Kindle for Web, then click the extension icon.');
  return tab;
}
async function frameRequest<T>(tabId: number, type: string, frameId = 0): Promise<T> {
  let response: Reply<T>;
  try { response = await chrome.tabs.sendMessage(tabId, { type }, { frameId }); }
  catch { throw new Error('Refresh the Kindle tab after installing or reloading the extension.'); }
  if (!response?.ok) throw new Error(response?.error || 'The reader did not respond.');
  return response.value;
}
async function checkPage(tabId: number, frameId: number, pageKey: string): Promise<void> {
  await reader(tabId);
  const current = await frameRequest<Snapshot>(tabId, 'snapshot', frameId);
  if (current.pageKey !== pageKey) throw new Error('The page changed during capture. Capture the passage again.');
}
async function newDraft(tabId: number, frameId: number, snapshot: Snapshot): Promise<Draft> {
  // The top frame carries the book identity when text is selected inside srcdoc.
  const top = await frameRequest<Snapshot>(tabId, 'snapshot');
  const tab = await reader(tabId);
  const metadata = {
    ...top.metadata,
    ...Object.fromEntries(Object.entries(snapshot.metadata).filter(([, value]) => value)),
    url: top.metadata.url || tab.url!,
    asin: top.metadata.asin || snapshot.metadata.asin,
    title: snapshot.metadata.title || top.metadata.title || tab.title || '',
  };
  const draft: Draft = {
    ...snapshot, metadata, id: crypto.randomUUID(), tabId, frameId,
    capturedAt: new Date().toISOString(), method: snapshot.text ? 'text' : 'ocr',
    text: snapshot.text || '', originalText: snapshot.text || '', status: snapshot.text ? 'ready' : 'recognizing',
  };
  await chrome.storage.session.set({ [draftKey(tabId)]: draft });
  return draft;
}
async function captureSelection(tabId: number): Promise<Draft> {
  await reader(tabId);
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => true });
  let lastError: unknown;
  for (const frame of results) {
    try {
      const value = await frameRequest<Snapshot | null>(tabId, 'selection', frame.frameId);
      if (value && (value.text || value.image)) return await newDraft(tabId, frame.frameId, value);
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError ? errorMessage(lastError) : 'Select a passage in the book first, or use Capture region for image-based pages.');
}
async function captureRegion(tabId: number): Promise<Draft | null> {
  const tab = await reader(tabId);
  const snapshot = await frameRequest<Snapshot | null>(tabId, 'region');
  if (!snapshot) return null;
  await checkPage(tabId, 0, snapshot.pageKey);
  const active = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (active?.id !== tabId) throw new Error('Return to the Kindle tab and capture again.');
  let image: string;
  try { image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
  catch { throw new Error('Click the extension toolbar icon while the Kindle tab is active to allow region capture, then try again.'); }
  const after = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (after?.id !== tabId) throw new Error('The active tab changed. Capture again.');
  await checkPage(tabId, 0, snapshot.pageKey);
  if (image.length > MAX_IMAGE_LENGTH) throw new Error('The screen capture is too large. Reduce the reader window and try again.');
  return newDraft(tabId, 0, { ...snapshot, image });
}

async function handle(message: Record<string, unknown>): Promise<unknown> {
  const tabId = message.tabId;
  if (!Number.isInteger(tabId) || (tabId as number) < 0) throw new Error('Choose a Kindle tab first.');
  const id = tabId as number;
  if (message.type === 'book') { await reader(id); return (await frameRequest<Snapshot>(id, 'snapshot')).metadata; }
  if (message.type === 'get') return readDraft(id);
  if (message.type === 'capture-selection') return captureSelection(id);
  if (message.type === 'capture-region') return captureRegion(id);
  if (message.type === 'clear') { await chrome.storage.session.remove(draftKey(id)); return null; }
  const draft = await readDraft(id);
  if (!draft || draft.id !== message.id) throw new Error('This capture has been replaced.');
  if (message.type === 'complete') {
    await checkPage(id, draft.frameId, draft.pageKey);
    const text = String(message.text || '').slice(0, 60_000);
    const updated: Draft = { ...draft, text, originalText: text, status: 'ready',
      image: typeof message.image === 'string' && message.image.length <= MAX_IMAGE_LENGTH ? message.image : undefined,
      rects: undefined, viewport: undefined,
      confidence: Number(message.confidence) || 0, durationMs: Number(message.durationMs) || 0 };
    await chrome.storage.session.set({ [draftKey(id)]: updated });
    return updated;
  }
  if (message.type === 'fail') {
    const updated = { ...draft, status: 'error', error: String(message.error || 'Recognition failed.') };
    await chrome.storage.session.set({ [draftKey(id)]: updated });
    return updated;
  }
  if (message.type === 'edit') {
    const updated: Draft = { ...draft, text: String(message.text ?? draft.text).slice(0, 60_000),
      status: typeof message.text === 'string' && message.text.trim() && message.text !== draft.text ? 'ready' : draft.status,
      metadata: { ...draft.metadata, title: String(message.title ?? draft.metadata.title).slice(0, 1000),
        author: String(message.author ?? draft.metadata.author).slice(0, 1000), location: String(message.location ?? draft.metadata.location).slice(0, 1000) } };
    await chrome.storage.session.set({ [draftKey(id)]: updated });
    return updated;
  }
  throw new Error('Unknown capture action.');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'native-selection' && sender.id === chrome.runtime.id && sender.tab?.id && isKindle(sender.tab.url)) {
    void chrome.runtime.sendMessage({ type: 'kindle-selection-ready', tabId: sender.tab.id }).catch(() => {});
    return;
  }
  // Website/content-script messages cannot start captures or modify drafts.
  if (sender.id !== chrome.runtime.id || !sender.url || sender.url.split(/[?#]/)[0] !== chrome.runtime.getURL('panel.html')) return;
  if (!message || typeof message !== 'object') return;
  void serialize(Number(message.tabId), () => handle(message)).then(value => reply({ ok: true, value }), error => reply({ ok: false, error: errorMessage(error) }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void serialize(tabId, () => chrome.storage.session.remove([draftKey(tabId), `book-details:${tabId}`, `selection-state:${tabId}`])); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) {
    void serialize(tabId, () => chrome.storage.session.remove(draftKey(tabId)));
  }
});
