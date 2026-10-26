import { MAX_IMAGE_LENGTH, errorMessage, type Rect, type Snapshot } from './shared';
import { readBookMetadata } from './book-metadata';

// An isolated content script in each matching frame. No hooks into Kindle's JS.
let lastSelection: { text: string; pageKey: string } | undefined;
let cancelRegion: (() => void) | undefined;
let revision = 0;
const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
const metadata = readBookMetadata;
function pageKey(): string {
  const image = document.querySelector<HTMLImageElement>('.kg-full-page-img img');
  const identity = [location.href, metadata().location, image?.currentSrc, innerWidth, innerHeight, revision, document.querySelector('#kr-fullpage-app')?.getAttribute('data-location')].join('|');
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return `${identity.length}:${hash >>> 0}`;
}
document.addEventListener('selectionchange', () => {
  const text = getSelection()?.toString().trim();
  if (text) lastSelection = { text, pageKey: pageKey() };
});
document.addEventListener('mouseup', () => {
  const text = getSelection()?.toString().trim();
  if (text && text.length <= 60_000) void chrome.runtime.sendMessage({ type: 'native-selection' }).catch(() => {});
});
document.addEventListener('pointerdown', () => { lastSelection = undefined; if (!cancelRegion) revision++; }, true);
document.addEventListener('keydown', event => {
  if (!cancelRegion && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) revision++;
}, true);
addEventListener('scroll', () => { if (!cancelRegion) revision++; }, true);
addEventListener('pagehide', () => { lastSelection = undefined; cancelRegion?.(); });

function snapshot(): Snapshot {
  const key = pageKey();
  const text = getSelection()?.toString().trim() || (lastSelection?.pageKey === key ? lastSelection.text : '');
  if (text.length > 60_000) throw new Error('The passage is too long. Select a smaller passage.');
  return { pageKey: key, metadata: metadata(), ...(text ? { text } : {}) };
}
function imageSelection(): Snapshot | null {
  const selected = [...document.querySelectorAll('.kg-selection')].filter(visible);
  const image = document.querySelector<HTMLImageElement>('.kg-full-page-img img');
  if (!selected.length || !image?.complete || !image.naturalWidth) return null;
  const page = image.getBoundingClientRect();
  const rects = selected.map(element => element.getBoundingClientRect()).map(rect => ({
    x: Math.max(rect.left, page.left), y: Math.max(rect.top, page.top),
    width: Math.min(rect.right, page.right) - Math.max(rect.left, page.left),
    height: Math.min(rect.bottom, page.bottom) - Math.max(rect.top, page.top),
  })).filter(rect => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(rect => rect.x)), top = Math.min(...rects.map(rect => rect.y));
  const width = Math.max(...rects.map(rect => rect.x + rect.width)) - left;
  const height = Math.max(...rects.map(rect => rect.y + rect.height)) - top;
  const scale = image.naturalWidth / page.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  if (canvas.width * canvas.height > 16_000_000) throw new Error('Select a smaller passage.');
  const ctx = canvas.getContext('2d')!;
  const clip = new Path2D();
  rects.forEach(rect => clip.rect((rect.x - left) * scale, (rect.y - top) * scale, rect.width * scale, rect.height * scale));
  ctx.clip(clip);
  ctx.drawImage(image, (page.left - left) * scale, (page.top - top) * scale, page.width * scale, page.height * scale);
  const data = canvas.toDataURL('image/png'); // May fail on a cross-origin image: use region capture instead.
  if (data.length > MAX_IMAGE_LENGTH) throw new Error('Select a smaller passage.');
  return { ...snapshot(), text: undefined, image: data };
}

async function pickRegion(): Promise<Snapshot | null> {
  if (window !== top) return null;
  cancelRegion?.();
  const initial = snapshot();
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;cursor:crosshair;background:rgba(0,0,0,.08);touch-action:none;';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Select a passage region');
    const help = document.createElement('div');
    help.textContent = 'Drag around a passage · Esc to cancel';
    help.style.cssText = 'position:absolute;top:16px;left:16px;padding:10px 16px;border-radius:8px;background:#162921;color:white;font:15px system-ui;';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #207555;background:rgba(32,117,85,.12);pointer-events:none;display:none;';
    overlay.append(help, box); shadow.append(overlay); document.documentElement.append(host);
    let origin: { x: number; y: number } | undefined;
    let finished = false;
    const finish = (value: Snapshot | null) => {
      if (finished) return;
      finished = true; host.remove(); document.removeEventListener('keydown', keydown, true);
      cancelRegion = undefined;
      // Wait for the selection overlay to leave the compositor before screenshotting.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); } };
    cancelRegion = () => finish(null);
    document.addEventListener('keydown', keydown, true);
    overlay.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); overlay.setPointerCapture(event.pointerId);
      origin = { x: event.clientX, y: event.clientY };
    };
    const rectFor = (event: PointerEvent): Rect => ({
      x: Math.min(origin!.x, event.clientX), y: Math.min(origin!.y, event.clientY),
      width: Math.abs(event.clientX - origin!.x), height: Math.abs(event.clientY - origin!.y),
    });
    overlay.onpointermove = event => {
      if (!origin) return;
      const rect = rectFor(event);
      Object.assign(box.style, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    overlay.onpointerup = event => {
      if (!origin) return;
      event.preventDefault(); event.stopPropagation();
      const rect = rectFor(event);
      finish(rect.width >= 12 && rect.height >= 12 && pageKey() === initial.pageKey
        ? { ...initial, text: undefined, rects: [rect], viewport: { width: innerWidth, height: innerHeight } } : null);
    };
  });
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'snapshot') {
    try { reply({ ok: true, value: snapshot() }); }
    catch (error) { reply({ ok: false, error: errorMessage(error) }); }
    return;
  }
  if (message?.type === 'selection') {
    try { const current = snapshot(); reply({ ok: true, value: current.text ? current : imageSelection() }); }
    catch (error) { reply({ ok: false, error: `${errorMessage(error)} Use Capture region instead.` }); }
    return;
  }
  if (message?.type === 'region') {
    void pickRegion().then(value => reply({ ok: true, value })).catch(error => reply({ ok: false, error: errorMessage(error) }));
    return true;
  }
});
