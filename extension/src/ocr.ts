import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { Draft } from './shared';

let worker: Promise<Worker> | undefined;
let report: (status: string, progress: number) => void = () => {};
export async function stopOcr(): Promise<void> {
  const current = worker; worker = undefined;
  if (current) await (await current.catch(() => undefined))?.terminate();
}
async function imageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = source; await image.decode(); return image;
}
export async function recognize(draft: Draft, onProgress: typeof report): Promise<{ text: string; confidence: number; image: string; durationMs: number }> {
  report = onProgress;
  const started = performance.now();
  const image = await imageElement(draft.image!);
  const sourceScale = draft.viewport ? image.naturalWidth / draft.viewport.width : 1;
  const rects = draft.rects?.map(rect => ({ x: rect.x * sourceScale, y: rect.y * sourceScale, width: rect.width * sourceScale, height: rect.height * sourceScale })) ??
    [{ x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }];
  const x = Math.max(0, Math.min(...rects.map(rect => rect.x)));
  const y = Math.max(0, Math.min(...rects.map(rect => rect.y)));
  const width = Math.min(image.naturalWidth, Math.max(...rects.map(rect => rect.x + rect.width))) - x;
  const height = Math.min(image.naturalHeight, Math.max(...rects.map(rect => rect.y + rect.height))) - y;
  const scale = width < 1200 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  if (width <= 0 || height <= 0 || canvas.width * canvas.height > 16_000_000) throw new Error('Capture a smaller passage and try again.');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const mask = new Path2D();
  rects.forEach(rect => mask.rect((rect.x - x) * scale, (rect.y - y) * scale, rect.width * scale, rect.height * scale));
  ctx.clip(mask); ctx.drawImage(image, -x * scale, -y * scale, image.naturalWidth * scale, image.naturalHeight * scale);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0, count = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3]) { sum += .299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]; count++; }
  }
  const invert = count > 0 && sum / count < 128;
  for (let i = 0; i < pixels.data.length; i += 4) {
    let value = .299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2];
    if (invert) value = 255 - value;
    value = value * pixels.data[i + 3] / 255 + 255 * (1 - pixels.data[i + 3] / 255);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const prepared = canvas.toDataURL('image/png');
  if (!worker) {
    worker = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
      corePath: chrome.runtime.getURL('ocr'),
      langPath: chrome.runtime.getURL('ocr'),
      workerBlobURL: false,
      logger: message => report(message.status, message.progress),
    }).catch(error => { worker = undefined; throw error; });
  }
  const engine = await worker;
  await engine.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  const result = await engine.recognize(canvas);
  const text = result.data.text.trim();
  if (!text) throw new Error('No readable text found. Capture a closer region with larger text, then retry.');
  if (text.length > 60_000) throw new Error('The passage is too long. Capture a smaller region.');
  return { text, confidence: result.data.confidence, image: prepared, durationMs: Math.round(performance.now() - started) };
}
