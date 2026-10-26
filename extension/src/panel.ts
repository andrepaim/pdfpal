import { bookIdentity, draftKey, errorMessage, isKindle, markdown, request, type Draft, type Metadata } from './shared';
import { recognize, stopOcr } from './ocr';
import { mountCompanion } from './companion';
import 'katex/dist/katex.min.css';
import '../panel.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = element<HTMLTextAreaElement>('text');
const title = element<HTMLInputElement>('title');
const author = element<HTMLInputElement>('author');
const location = element<HTMLInputElement>('location');
let tabId: number | undefined;
let draft: Draft | undefined;
let book: Metadata | undefined;
let busy = false;
let epoch = 0;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise = Promise.resolve();
type BookField = 'title' | 'author' | 'location';
const editedBookFields = new Set<BookField>();
let refreshingBook = false;
let companion: ReturnType<typeof mountCompanion> | undefined;
const fixedTab = Number(new URLSearchParams(window.location.search).get('tabId')) || undefined;
function status(message: string, error = false) {
  element('status').textContent = message; element('status').dataset.error = String(error);
}
function controls() {
  for (const id of ['capture', 'region']) element<HTMLButtonElement>(id).disabled = !tabId || busy;
  for (const id of ['copy', 'export']) element<HTMLButtonElement>(id).disabled = !draft || !text.value.trim() || busy || draft.status !== 'ready';
  text.disabled = busy || !draft;
  for (const field of [title, author, location]) field.disabled = busy || !book;
  element<HTMLButtonElement>('clear').disabled = busy;
  companion?.update(draft, busy, book);
}
function render() {
  element('passage-fields').hidden = !draft;
  const metadata = draft?.metadata || book;
  if (metadata) { title.value = metadata.title; author.value = metadata.author; location.value = metadata.location; }
  if (draft) {
    text.value = draft.text; title.value = draft.metadata.title; author.value = draft.metadata.author; location.value = draft.metadata.location;
    element('method').textContent = draft.method === 'ocr' ? 'OCR · review text' : 'Selected text';
    element('quality').textContent = draft.confidence !== undefined
      ? `OCR confidence ${Math.round(draft.confidence)}% · ${(draft.durationMs! / 1000).toFixed(1)}s. Check names, punctuation, code, and equations before keeping this passage.`
      : 'Book details and location can be corrected here.';
    element('image-details').hidden = !draft.image || !!draft.rects;
    if (draft.image && !draft.rects) element<HTMLImageElement>('image').src = draft.image;
    element('retry').hidden = draft.method !== 'ocr' || !draft.image;
  }
  controls();
}
async function restoreBookDetails(metadata: Metadata, id: number, generation: number): Promise<Metadata> {
  const saved = (await chrome.storage.session.get(`book-details:${id}`))[`book-details:${id}`] as
    { identity: string; title?: string; author?: string; edited?: BookField[] } | undefined;
  if (generation !== epoch || saved?.identity !== bookIdentity(metadata)) return metadata;
  const restored = { ...metadata };
  for (const field of ['title', 'author'] as const) {
    // Older panels saved blank fields just by closing the dialog. Do not let
    // those blanks hide details that the reader can now supply.
    if (typeof saved[field] === 'string' && (saved[field]!.trim() || saved.edited?.includes(field))) {
      restored[field] = saved[field]!; editedBookFields.add(field);
    }
  }
  return restored;
}
async function saveEdits(): Promise<void> {
  clearTimeout(editTimer);
  if (!book) return;
  const currentDraft = draft, currentTab = tabId;
  const values = { text: text.value, title: title.value, author: author.value, location: location.value };
  book = { ...book, title: title.value, author: author.value, location: location.value };
  element('reader').textContent = book.title || 'Kindle book';
  if (tabId && editedBookFields.size) await chrome.storage.session.set({ [`book-details:${tabId}`]: {
    identity: bookIdentity(book), edited: [...editedBookFields],
    ...(editedBookFields.has('title') ? { title: book.title } : {}),
    ...(editedBookFields.has('author') ? { author: book.author } : {}),
  } });
  if (tabId !== currentTab || draft?.id !== currentDraft?.id) return;
  if (!draft) { companion?.update(draft, busy, book); return; }
  const message = { type: 'edit', tabId: draft.tabId, id: draft.id, ...values };
  savePromise = savePromise.catch(() => {}).then(async () => {
    const updated = await request<Draft>(message);
    if (draft?.id === updated.id) draft = updated;
  });
  await savePromise;
  controls();
}
for (const input of [text, title, author, location]) input.addEventListener('input', () => {
  if (input !== text) editedBookFields.add(input.id as BookField);
  controls(); clearTimeout(editTimer);
  editTimer = setTimeout(() => { void saveEdits().catch(error => status(errorMessage(error), true)); }, 250);
});
async function chooseTab(force = false): Promise<void> {
  const next = fixedTab ? await chrome.tabs.get(fixedTab) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const id = next?.id && isKindle(next.url) ? next.id : undefined;
  if (!force && id === tabId && id !== undefined) return;
  clearTimeout(editTimer); const generation = ++epoch; tabId = id; draft = undefined; book = undefined;
  editedBookFields.clear();
  await stopOcr();
  if (generation !== epoch) return;
  busy = false; element('progress').hidden = true;
  element('reader').textContent = id ? next.title || 'Kindle for Web' : 'Open Kindle for Web (.com, .com.br, or .co.uk), then click the extension icon.';
  if (id) {
    const [loadedDraft, metadata] = await Promise.all([request<Draft | undefined>({ type: 'get', tabId: id }), request<Metadata>({ type: 'book', tabId: id })]);
    if (generation !== epoch) return;
    draft = loadedDraft; book = metadata;
    const restored = await restoreBookDetails(book, id, generation);
    if (generation !== epoch) return;
    book = restored;
    element('reader').textContent = book.title || next.title || 'Kindle book';
  }
  render();
  if (draft?.status === 'recognizing') status('Recognition was interrupted. Retry OCR or capture the passage again.');
  else status('');
}
async function runOcr(): Promise<void> {
  if (!draft?.image) return;
  const current = draft, generation = epoch;
  busy = true; render(); element('progress').hidden = false;
  status('Reading the passage on this device…');
  try {
    const result = await recognize(current, (stage, progress) => {
      if (epoch !== generation) return;
      element<HTMLProgressElement>('progress').value = progress;
      status(stage === 'recognizing text' ? 'Recognizing passage…' : 'Preparing local OCR…');
    });
    if (epoch !== generation || draft?.id !== current.id) return;
    draft = await request<Draft>({ type: 'complete', tabId: current.tabId, id: current.id, ...result });
    status('');
  } catch (error) {
    if (epoch !== generation) return;
    status(errorMessage(error), true);
    await stopOcr();
    const failed = await request<Draft>({ type: 'fail', tabId: current.tabId, id: current.id, error: errorMessage(error) }).catch(() => undefined);
    if (failed && draft?.id === failed.id) draft = failed;
  } finally {
    if (epoch === generation) { busy = false; element('progress').hidden = true; render(); }
  }
}
async function capture(type: 'capture-selection' | 'capture-region') {
  if (!tabId || busy) return;
  await saveEdits();
  const generation = epoch;
  busy = true; controls();
  status(type === 'capture-region' ? 'Drag around the passage in the Kindle tab. Press Esc to cancel.' : 'Capturing your selection…');
  try {
    const result = await request<Draft | null>({ type, tabId });
    if (epoch !== generation) return;
    if (!result) { status('Region capture cancelled.'); return; }
    draft = result; book = { ...result.metadata, title: book?.title || result.metadata.title, author: book?.author || result.metadata.author }; render();
    if (draft.method === 'ocr') await runOcr();
    else status('');
  } catch (error) { status(errorMessage(error), true); }
  finally { if (epoch === generation) { busy = false; controls(); } }
}
function perform(action: () => Promise<void>) {
  void action().catch(error => status(errorMessage(error), true));
}
element('capture').onclick = () => perform(() => capture('capture-selection'));
element('region').onclick = () => perform(() => capture('capture-region'));
element('retry').onclick = () => perform(runOcr);
async function refreshBookDetails() {
  if (!tabId || refreshingBook || busy) return;
  const id = tabId, generation = epoch;
  refreshingBook = true; element<HTMLButtonElement>('refresh-book').disabled = true;
  element('book-details-status').textContent = 'Reading book details…';
  try {
    let fresh = await request<Metadata>({ type: 'book', tabId: id });
    if (id !== tabId || generation !== epoch) return;
    fresh = await restoreBookDetails(fresh, id, generation);
    if (id !== tabId || generation !== epoch || !element<HTMLDialogElement>('preview').open) return;
    for (const field of ['title', 'author', 'location'] as const) {
      if (editedBookFields.has(field)) fresh[field] = element<HTMLInputElement>(field).value;
      else if (!fresh[field] && book && bookIdentity(book) === bookIdentity(fresh)) fresh[field] = book[field];
    }
    book = fresh;
    if (draft && bookIdentity(draft.metadata) === bookIdentity(book)) {
      draft = { ...draft, metadata: { ...draft.metadata, title: book.title, author: book.author,
        ...(editedBookFields.has('location') ? { location: book.location } : {}) } };
    }
    element('reader').textContent = book.title || 'Kindle book';
    const metadata = draft?.metadata || book;
    title.value = metadata.title; author.value = metadata.author; location.value = metadata.location;
    controls();
    element('book-details-status').textContent = book.title
      ? 'Book details refreshed. You can edit them before adding the book.'
      : 'Kindle has not exposed a book title yet. Enter it below, or show the reader toolbar and refresh details. Author and location are optional.';
  } catch (error) {
    if (id === tabId && generation === epoch) element('book-details-status').textContent = errorMessage(error);
  } finally {
    refreshingBook = false; element<HTMLButtonElement>('refresh-book').disabled = false;
  }
}
function review() {
  render(); const dialog = element<HTMLDialogElement>('preview'); if (!dialog.open) dialog.showModal();
  perform(refreshBookDetails);
}
element('review').onclick = review;
element('book-details').onclick = review;
element('refresh-book').onclick = () => perform(refreshBookDetails);
element('close-preview').onclick = () => element<HTMLDialogElement>('preview').close();
element('preview').addEventListener('close', () => perform(saveEdits));
element('clear').onclick = () => perform(async () => {
  await saveEdits(); if (!tabId) return;
  await request({ type: 'clear', tabId }); draft = undefined; render(); status('Capture discarded.');
});
element('copy').onclick = () => perform(async () => {
  await saveEdits(); if (!draft) return;
  await navigator.clipboard.writeText(markdown(draft)); status('Passage copied as Markdown.');
});
element('export').onclick = () => perform(async () => {
  await saveEdits(); if (!draft) return;
  const { image: _image, viewport: _viewport, rects: _rects, ...record } = draft;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, ...record }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `kindle-capture-${draft.id}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status('Capture exported.');
});
chrome.tabs.onActivated.addListener(() => { if (!fixedTab) perform(chooseTab); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') { perform(() => chooseTab(true)); return; }
  if (change.status === 'complete' && !tabId) { perform(chooseTab); return; }
  if (id !== tabId || (!change.url && change.status !== 'loading')) return;
  epoch++; busy = false; draft = undefined; book = undefined; clearTimeout(editTimer);
  void stopOcr(); render(); element('progress').hidden = true;
  status('');
  if (change.url && !isKindle(change.url)) { tabId = undefined; controls(); }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && !sender.tab && message?.type === 'kindle-selection-ready' && message.tabId === tabId && !busy) {
    perform(() => capture('capture-selection'));
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && tabId && changes[draftKey(tabId)] && !changes[draftKey(tabId)].newValue) {
    epoch++; busy = false; draft = undefined; void stopOcr(); element('progress').hidden = true; render();
  }
});
addEventListener('pagehide', () => { void stopOcr(); });
companion = mountCompanion(() => draft, saveEdits, () => tabId);
render(); perform(chooseTab);
