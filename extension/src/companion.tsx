import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Markdown from '../../frontend/src/components/Markdown';
import VisualExplanation, { type VisualTransport } from '../../frontend/src/components/VisualExplanation';
import ChatCommandHint from '../../frontend/src/components/ChatCommandHint';
import { isVisualCommandPrefix, parseChatInput, type ChatInput } from '../../src/shared/chat-command';
import { bookIdentity, errorMessage, type Draft, type Metadata } from './shared';

type Capture = Pick<Draft, 'text' | 'originalText' | 'metadata' | 'method' | 'capturedAt'> & { scope?: 'selection' | 'book' };
type Connection = { base: string; token: string; clientId: string; projectId: string };
type Turn = { id: string; question: string; answer: string | null; status: 'pending' | 'running' | 'complete' | 'failed';
  error: string | null; capture: Capture; research: Array<{ source_title: string; page_number: number }>; visual_id?: string | null; response_mode?: 'text' | 'visual' };
type Ask = { request_id: string; project_id: string; capture: Capture; question: string; include_project: boolean; response_mode?: 'text' | 'visual' };
class BridgeError extends Error { constructor(public status: number, message: string) { super(message); } }
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const snapshot = (draft: Draft): Capture => ({ text: draft.text, originalText: draft.originalText, metadata: { ...draft.metadata }, method: draft.method, capturedAt: draft.capturedAt });
function baseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a local address such as http://127.0.0.1:8200.');
  }
  return url.origin;
}
const identity = bookIdentity;
async function api<T>(connection: Connection, path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(connection.base)}/api/extension${path}`, { method,
      headers: { authorization: `Bearer ${connection.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), credentials: 'omit' });
  } catch { throw new Error('Cannot reach pdfpal. Start or restart the updated server at the address above, then retry.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Update and restart the pdfpal server to enable the Kindle companion.');
  const result = await response.json();
  if (!response.ok) throw new BridgeError(response.status, result.detail || `pdfpal returned ${response.status}.`);
  return result;
}

export function mountCompanion(getDraft: () => Draft | undefined, flush: () => Promise<void>) {
  let connection: Connection | undefined;
  const restored = chrome.storage.local.get('companionConnection').then(values => {
    connection = values.companionConnection as Connection | undefined;
  });
  let connecting = false;
  let currentBook: Metadata | undefined;
  let attachedId: string | undefined, seenDraftId: string | undefined;
  let attachmentVersion = 0, attachmentLoading = false;
  let currentKey = '', generation = 0, working = false, captureBusy = false, loading = false;
  let turns: Turn[] = [];
  let renderedRoots: ReturnType<typeof createRoot>[] = [];
  const commandRoot = createRoot(el('chat-command'));
  const pendingKey = () => `kindle-request:${currentKey}`;
  function message(value: string, error = false) {
    el('companion-status').textContent = value; el('companion-status').dataset.error = String(error);
  }
  function attached() { const draft = getDraft(); return draft?.id === attachedId && draft?.status === 'ready' && draft.text.trim() ? draft : undefined; }
  function usable() { return !!connection?.projectId && !!currentBook && !captureBusy && !attachmentLoading; }
  function detach() {
    const draft = getDraft();
    attachedId = undefined; attachmentVersion++; attachmentLoading = false;
    if (draft) void chrome.storage.session.set({ [`selection-state:${draft.tabId}`]: { id: draft.id, attached: false } }).catch(() => {});
    controls();
  }
  function settings() { const dialog = el<HTMLDialogElement>('settings-dialog'); if (!dialog.open) dialog.showModal(); }
  function controls() {
    const selection = attached();
    for (const id of ['ask', 'explain', 'save-passage']) el<HTMLButtonElement>(id).disabled = !usable() || working || loading || (id !== 'ask' && !selection);
    el<HTMLTextAreaElement>('question').disabled = !usable() || working || loading;
    el<HTMLButtonElement>('ask').disabled ||= !el<HTMLTextAreaElement>('question').value.trim();
    el<HTMLSelectElement>('project').disabled = working;
    el<HTMLButtonElement>('clear-chat').disabled = !turns.length || working || loading;
    el('selection-banner').hidden = !selection;
    el('explain').hidden = !selection;
    document.body.dataset.selection = String(!!selection);
    if (selection) {
      el('selection-text').textContent = selection.text;
      el('selection-label').textContent = selection.metadata.location ? `Selection · ${selection.metadata.location}` : 'Selection attached';
    }
    el<HTMLTextAreaElement>('question').placeholder = !connection ? 'Connect to pdfpal to chat…' : !currentBook ? 'Open a Kindle book…' : selection ? 'Ask about the selection, or type /visual…' : 'Ask about the book, or type /visual…';
    el('context-hint').textContent = selection ? 'Selection attached · Enter to send · Shift+Enter for a new line' : 'Book details & captured excerpts · No selection attached';
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-save-turn]')) button.disabled = working || loading;
    commandRoot.render(!working && !loading ? <ChatCommandHint input={el<HTMLTextAreaElement>('question').value} hasSelection={!!selection} onChoose={chooseVisual} /> : null);
  }
  function chooseVisual() {
    const question = el<HTMLTextAreaElement>('question'); question.value = '/visual '; question.focus();
    question.setSelectionRange(question.value.length, question.value.length); controls();
  }
  function renderTurns() {
    const area = el('messages');
    const follow = area.scrollHeight - area.scrollTop - area.clientHeight < 100 || !area.querySelector('.chat-turn');
    renderedRoots.forEach(root => root.unmount()); renderedRoots = [];
    area.replaceChildren();
    if (!turns.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = '✧'; icon.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('h1'); heading.textContent = 'Ask anything about the book';
      const hint = document.createElement('p'); hint.textContent = connection
        ? 'Explore an idea, connect it to what you know, or select a passage to ask about it.'
        : 'Connect to your local pdfpal to start a conversation. You can also capture and export selections.';
      empty.append(icon, heading, hint);
      if (!connection) { const connect = document.createElement('button'); connect.className = 'primary'; connect.textContent = 'Connect to pdfpal'; connect.onclick = settings; empty.append(connect); }
      area.append(empty);
    }
    for (const turn of turns) {
      const article = document.createElement('article'); article.className = 'chat-turn';
      const question = document.createElement('div'); question.className = 'chat-question';
      if (turn.capture.text) {
        const quote = document.createElement('details'); quote.className = 'quoted-selection';
        const summary = document.createElement('summary'); summary.textContent = `Selection${turn.capture.metadata.location ? ` · ${turn.capture.metadata.location}` : ''}`;
        const excerpt = document.createElement('blockquote'); excerpt.textContent = turn.capture.text;
        quote.append(summary, excerpt); question.append(quote);
      }
      const questionText = document.createElement('p'); questionText.textContent = turn.question; question.append(questionText);
      const answer = document.createElement('div'); answer.className = 'chat-answer';
      article.append(question, answer);
      if (turn.visual_id && connection && (turn.status === 'complete' || turn.status === 'failed')) {
        const connected = connection;
        const transport: VisualTransport = {
          get: id => api(connected, `/projects/${connected.projectId}/visuals/${id}`),
          save: id => api(connected, `/projects/${connected.projectId}/visuals/${id}/save`, {}),
          noteUrl: id => `${connected.base}/projects/${connected.projectId}/notes/${id}`,
        };
        const root = createRoot(answer); renderedRoots.push(root);
        flushSync(() => root.render(<VisualExplanation id={turn.visual_id!} transport={transport}
          onRetry={() => perform(() => ask(false, turn))}
          onFollowUp={question => { el<HTMLTextAreaElement>('question').value = question; controls(); el('question').focus(); }} />));
      } else if (turn.status === 'complete') {
        const root = createRoot(answer); renderedRoots.push(root); flushSync(() => root.render(<Markdown>{turn.answer || ''}</Markdown>));
        if (turn.research.length) {
          const citations = document.createElement('p'); citations.className = 'research-context';
          citations.textContent = 'Project context: ' + [...new Set(turn.research.map(item => `${item.source_title}, p. ${item.page_number}`))].join('; ');
          article.append(citations);
        }
        const save = document.createElement('button'); save.textContent = 'Save answer'; save.dataset.saveTurn = turn.id;
        save.onclick = () => perform(() => saveNote(turn));
        const actions = document.createElement('div'); actions.className = 'answer-actions'; actions.append(save); article.append(actions);
      } else if (turn.status === 'failed') { answer.textContent = turn.error || 'Answer failed. Ask again to retry.'; answer.dataset.error = 'true'; }
      else { const spinner = document.createElement('span'); spinner.className = 'spinner'; answer.append(spinner, 'Thinking…'); }
      area.append(article);
    }
    if (follow) requestAnimationFrame(() => {
      const latest = area.lastElementChild as HTMLElement | null;
      const visual = turns.at(-1);
      const top = visual?.visual_id && visual.status === 'complete' && latest
        ? area.scrollTop + latest.getBoundingClientRect().top - area.getBoundingClientRect().top : area.scrollHeight;
      area.scrollTo({ top, behavior: 'instant' });
    });
    controls();
  }
  function perform(action: () => Promise<unknown>) { void action().catch(error => { message(errorMessage(error), true); controls(); }); }
  async function persist() { if (connection) await chrome.storage.local.set({ companionConnection: connection }); }
  async function projects() {
    if (!connection) return;
    const connected = connection;
    const list = await api<Array<{ id: string; title: string }>>(connected, '/projects');
    if (connection !== connected) return;
    el<HTMLSelectElement>('project').replaceChildren(...list.map(project => new Option(project.title, project.id)));
    if (!list.some(project => project.id === connected.projectId)) connected.projectId = list[0]?.id || '';
    el<HTMLSelectElement>('project').value = connected.projectId;
    el('project-controls').hidden = false; el('new-project-form').hidden = list.length > 0;
    await persist(); update(getDraft(), captureBusy, currentBook);
  }
  async function connect() {
    if (connecting) return;
    connecting = true;
    el<HTMLButtonElement>('connect').disabled = true;
    try {
      await restored;
      const base = baseUrl(el<HTMLInputElement>('server-url').value.trim());
      const code = el<HTMLInputElement>('pair-code').value.trim();
      if (code) {
        const response = await fetch(`${base}/api/extension/pair`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, origin: `chrome-extension://${chrome.runtime.id}` }), credentials: 'omit', signal: AbortSignal.timeout(15_000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Pairing failed.');
        connection = { base, token: result.token, clientId: result.client_id, projectId: '' };
        el<HTMLInputElement>('pair-code').value = ''; await persist();
      }
      if (!connection || connection.base !== base) throw new Error('Run pdfpal extension pair and paste its code to connect.');
      const status = await api<{ agent: string }>(connection, '/status');
      el('connection-label').textContent = 'Connected to pdfpal';
      el('connection-status').textContent = `Connected · ${status.agent} agent`;
      el('agent-label').textContent = status.agent.charAt(0).toUpperCase() + status.agent.slice(1);
      el<HTMLDetailsElement>('connection-section').open = false; el('disconnect').hidden = false;
      el<HTMLDialogElement>('settings-dialog').close();
      await projects();
    } catch (error) {
      el<HTMLDetailsElement>('connection-section').open = true;
      settings();
      el('connection-status').textContent = error instanceof TypeError ? 'Cannot reach pdfpal. Start the updated server and check its address.' : errorMessage(error);
    } finally { connecting = false; el<HTMLButtonElement>('connect').disabled = false; controls(); }
  }
  function merge(turn: Turn) {
    const found = turns.findIndex(item => item.id === turn.id);
    if (found < 0) turns.push(turn); else turns[found] = turn;
    renderTurns();
  }
  async function watch(turn: Turn, expected: number, connected: Connection) {
    working = true; controls();
    try {
      let current = turn;
      while (expected === generation && (current.status === 'pending' || current.status === 'running')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        if (expected !== generation) return;
        const updated = await api<Turn>(connected, `/turns/${current.id}`);
        if (expected !== generation) return;
        if (updated.status !== current.status || updated.answer !== current.answer) merge(updated);
        current = updated;
      }
      if (expected === generation) message(current.status === 'failed' ? current.error || 'Answer failed.' : 'Answer ready.', current.status === 'failed');
    } finally {
      if (expected === generation) {
        working = false; controls();
        if (!document.querySelector('dialog[open]')) el('question').focus({ preventScroll: true });
      }
    }
  }
  async function submit(payload: Ask, expected: number) {
    if (!connection) return;
    const connected = connection, key = pendingKey();
    working = true; controls(); message('Asking your pdfpal agent…');
    try {
      await chrome.storage.session.set({ [key]: payload });
      const turn = await api<Turn>(connected, '/turns', payload);
      await chrome.storage.session.remove(key);
      if (expected !== generation) return;
      if (payload.capture.scope !== 'book') detach();
      merge(turn); el('retry-chat').hidden = true;
      requestAnimationFrame(() => { el('messages').scrollTo({ top: el('messages').scrollHeight, behavior: 'instant' }); });
      await watch(turn, expected, connected);
    } catch (error) {
      if (error instanceof BridgeError && error.status >= 400 && error.status < 500 && error.status !== 429) await chrome.storage.session.remove(key);
      if (expected === generation) { message(errorMessage(error), true); el('retry-chat').hidden = false; }
    } finally { if (expected === generation) { working = false; controls(); } }
  }
  async function history(expected: number) {
    const metadata = currentBook;
    if (!connection?.projectId || !metadata) return;
    const connected = connection, key = pendingKey();
    loading = true; controls();
    try {
      const result = await api<{ turns: Turn[] }>(connected, '/history', { project_id: connected.projectId, metadata });
      if (expected !== generation) return;
      turns = result.turns; renderTurns();
      loading = false;
      const pending = (await chrome.storage.session.get(key))[key] as Ask | undefined;
      if (expected !== generation) return;
      if (pending) { await submit(pending, expected); return; }
      const active = turns.find(turn => turn.status === 'pending' || turn.status === 'running');
      if (active) await watch(active, expected, connected);
    } catch (error) {
      if (expected === generation) { message(errorMessage(error), true); el('retry-chat').hidden = false; }
    } finally { if (expected === generation) { loading = false; controls(); } }
  }
  function update(capture: Draft | undefined, busy: boolean, metadata: Metadata | undefined) {
    captureBusy = busy;
    currentBook = metadata;
    let key = '';
    try { if (connection && metadata) key = `${connection.base}:${connection.clientId}:${connection.projectId}:${identity(metadata)}`; } catch { /* Wait for a reader URL. */ }
    if (key !== currentKey) {
      generation++; currentKey = key; working = false; loading = false; turns = [];
      el('saved-note').hidden = true; el('retry-chat').hidden = true; message(''); renderTurns();
      if (key && connection?.projectId) perform(() => history(generation));
    }
    if (capture?.id !== seenDraftId) {
      seenDraftId = capture?.id; attachedId = capture?.id;
      const version = ++attachmentVersion;
      attachmentLoading = !!capture;
      if (capture) void chrome.storage.session.get(`selection-state:${capture.tabId}`).then(values => {
        if (version !== attachmentVersion || getDraft()?.id !== capture.id) return;
        const state = values[`selection-state:${capture.tabId}`] as { id: string; attached: boolean } | undefined;
        if (state?.id === capture.id && !state.attached) attachedId = undefined;
      }).finally(() => { if (version === attachmentVersion) { attachmentLoading = false; controls(); } }).catch(() => {});
    }
    controls();
  }
  async function ask(explain = false, fromTurn?: Turn) {
    await flush();
    const capture = attached();
    if (!currentBook || !connection || !usable() || working || (explain && !capture)) return;
    const command: ChatInput = fromTurn ? { kind: 'visual', question: fromTurn.question } : explain
      ? { kind: 'text', question: 'Explain this passage clearly. Unpack the main idea and any concepts or assumptions needed to understand it.' }
      : parseChatInput(el<HTMLTextAreaElement>('question').value, !!capture);
    if (command.kind === 'help' || command.kind === 'empty') { controls(); el('question').focus(); return; }
    const question = command.question;
    const context: Capture = fromTurn ? fromTurn.capture : capture ? { ...snapshot(capture), scope: 'selection' }
      : { text: '', originalText: '', metadata: { ...currentBook }, method: 'text', capturedAt: new Date().toISOString(), scope: 'book' };
    const payload: Ask = { request_id: crypto.randomUUID(), project_id: connection.projectId, capture: context, question,
      include_project: fromTurn ? fromTurn.research.length > 0 : el<HTMLInputElement>('include-project').checked, response_mode: command.kind === 'visual' ? 'visual' : 'text' };
    el<HTMLTextAreaElement>('question').value = '';
    await submit(payload, generation);
  }
  async function saveNote(turn?: Turn) {
    await flush();
    const capture = attached();
    if ((!capture && !turn) || !connection || !usable() || working) return;
    const expected = generation, connected = connection;
    working = true; controls();
    try {
      const content = { project_id: connected.projectId, capture: turn?.capture || snapshot(capture!), ...(turn ? { turn_id: turn.id } : {}) };
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const key = `kindle-note:${connected.clientId}:${hash}`;
      let requestId = (await chrome.storage.session.get(key))[key] as string | undefined;
      if (!requestId) { requestId = crypto.randomUUID(); await chrome.storage.session.set({ [key]: requestId }); }
      const note = await api<{ id: string }>(connected, '/notes', { ...content, request_id: requestId });
      if (expected !== generation) return;
      el<HTMLAnchorElement>('saved-note').href = `${connected.base}/projects/${encodeURIComponent(connected.projectId)}/notes/${encodeURIComponent(note.id)}`;
      el('saved-note').hidden = false; message(turn ? 'Answer saved to your project notes.' : 'Passage saved to your project notes.');
    } finally { if (expected === generation) { working = false; controls(); } }
  }

  el('connect').onclick = () => perform(connect);
  el('settings').onclick = settings;
  el('close-settings').onclick = () => el<HTMLDialogElement>('settings-dialog').close();
  el('remove-selection').onclick = () => { detach(); el('question').focus(); };
  el('clear-chat').onclick = () => perform(async () => {
    if (!connection || !currentBook || working) return;
    const expected = generation;
    await api(connection, '/history/clear', { project_id: connection.projectId, metadata: currentBook });
    if (expected !== generation) return;
    await chrome.storage.session.remove(pendingKey()); turns = []; renderTurns(); message('Conversation cleared.');
  });
  el('disconnect').onclick = () => perform(async () => {
    await restored;
    const previous = connection; connection = undefined; generation++; currentKey = ''; working = false;
    await chrome.storage.local.remove('companionConnection');
    if (previous) await api(previous, '/connection', undefined, 'DELETE').catch(() => {});
    el('project-controls').hidden = true; el('disconnect').hidden = true;
    el('connection-label').textContent = 'Connect to pdfpal'; el('connection-status').textContent = 'Disconnected. Capture and export still work.';
    el<HTMLDetailsElement>('connection-section').open = true; update(getDraft(), captureBusy, currentBook); renderTurns();
  });
  el<HTMLSelectElement>('project').onchange = () => perform(async () => {
    if (!connection) return;
    connection.projectId = el<HTMLSelectElement>('project').value; await persist(); update(getDraft(), captureBusy, currentBook);
  });
  el('new-project').onclick = () => { el('new-project-form').hidden = false; settings(); el('project-title').focus(); };
  el('new-project-form').onsubmit = event => {
    event.preventDefault(); perform(async () => {
      if (!connection) return;
      const project = await api<{ id: string }>(connection, '/projects', { title: el<HTMLInputElement>('project-title').value });
      connection.projectId = project.id; el<HTMLInputElement>('project-title').value = ''; await projects(); el<HTMLDialogElement>('settings-dialog').close();
    });
  };
  el('question').oninput = controls;
  el('question').onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Tab' && !event.shiftKey && isVisualCommandPrefix(el<HTMLTextAreaElement>('question').value)) { event.preventDefault(); chooseVisual(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!el<HTMLButtonElement>('ask').disabled) perform(() => ask()); }
  };
  el('ask').onclick = () => perform(() => ask()); el('explain').onclick = () => perform(() => ask(true));
  el('save-passage').onclick = () => perform(() => saveNote());
  el('retry-chat').onclick = () => perform(() => history(generation));
  perform(async () => {
    await restored;
    if (connection) { el<HTMLInputElement>('server-url').value = connection.base; await connect(); }
    controls();
  });
  renderTurns();
  return { update };
}
