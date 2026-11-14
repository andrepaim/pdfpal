// Stand-alone HTML export of a visual explanation. Figures are laid out and serialised by the same renderer the app
// uses (src/shared/visual-kit), so the export cannot drift from what the reader saw. Pure string building: importable
// under Node (tests use the approximate measurer) and in the browser (the app passes its canvas measurer and the
// bundled Inter font as a data URL).
import { visualFrames, type VisualDefinition, type VisualFrame, type VisualRecord } from '../../../src/shared/visual'
import { approximateMeasure, drawSceneV2, drawStepV1, svgMarkup, VISUAL_KIT_CSS, type Drawing, type Hotspot, type Measure, type VNode } from '../../../src/shared/visual-kit/index'

export type VisualHtmlOptions = {
  /** Text measurer used for layout; defaults to the approximate one. */
  measure?: Measure
  /** The bundled font as a data: URL. Anything else is ignored, so the export never loads a remote resource. */
  fontDataUrl?: string
  /** Layout width of the figures in px. */
  width?: number
}

export const visualBasisLabel = (basis: VisualFrame['basis']) => basis === 'source' ? 'Based on supplied text' : basis === 'illustration' ? 'Illustrative example' : 'Background knowledge'

/** The words a figure carries, for readers without the picture (transcript and export fallback). */
export function figureWords(definition: VisualDefinition, index: number): string[] {
  if (definition.version === 1) return definition.steps[index]?.scene.elements.flatMap(e => e.type === 'node' ? [`${e.label}${e.detail ? `: ${e.detail}` : ''}`] : []) ?? []
  const scene = definition.scenes[index]
  if (!scene) return []
  switch (scene.kind) {
    case 'flow': return scene.nodes.map(n => `${n.label}${n.sub ? ` (${n.sub})` : ''}${n.detail ? `: ${n.detail}` : ''}`)
    case 'quadrant': return scene.items.map(i => `${i.label} (${scene.y[i.quadrant.startsWith('top') ? 'high' : 'low']}, ${scene.x[i.quadrant.endsWith('right') ? 'high' : 'low']})${i.detail ? `: ${i.detail}` : ''}`)
    case 'bars': return scene.items.map(i => `${i.label}: ${i.display ?? `${i.value}${scene.unit ? ` ${scene.unit}` : ''}`}${i.note ? ` (${i.note})` : ''}`)
    case 'compare': return scene.rows.map(r => `${r.label}: ${scene.columns.map((c, i) => `${c.title}, ${r.cells[i] ?? ''}`).join('; ')}`)
    case 'cells': return scene.rows.map(r => `${r.label ? `${r.label}: ` : ''}${r.cells.map(c => c.text).join(' | ')}`)
    case 'plot': return scene.marks.flatMap(m => m.type === 'note' ? [m.text] : m.label ? [m.label] : [])
  }
}

/** Kept for stored-format callers and tests: greedy word wrap by an approximate character budget. */
export function wrapLabel(text: string, width: number): string[] {
  const limit = Math.max(3, Math.floor((width - 16) / 9))
  const words = text.split(/\s+/).flatMap(word => word.length > limit ? word.match(new RegExp(`.{1,${limit}}`, 'g'))! : [word])
  const lines: string[] = []
  for (const word of words) {
    if (lines.length && lines[lines.length - 1].length + word.length + 1 <= limit) lines[lines.length - 1] += ` ${word}`
    else lines.push(word)
  }
  return lines
}

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const sceneCount = (definition: VisualDefinition) => definition.version === 2 ? definition.scenes.length : definition.steps.length

/** Adds what the export's script needs to reveal a hotspot's detail without the app: the text itself, and focusability. */
function annotate(node: VNode, hotspots: Map<string, Hotspot>): VNode {
  const id = node.attrs['data-hotspot'], hotspot = id === undefined ? undefined : hotspots.get(String(id))
  const attrs = hotspot ? { ...node.attrs, 'data-detail': hotspot.detail, 'data-name': hotspot.label, role: 'button', tabindex: 0, 'aria-label': `${hotspot.label}: show more` } : node.attrs
  return { ...node, attrs, children: node.children.map(child => typeof child === 'string' ? child : annotate(child, hotspots)) }
}

function figureMarkup(definition: VisualDefinition, scene: number, title: string, options: Required<Pick<VisualHtmlOptions, 'measure' | 'width'>>): string {
  let drawing: Drawing
  try {
    drawing = definition.version === 2 ? drawSceneV2(definition.scenes[scene], { width: options.width, measure: options.measure }) : drawStepV1(definition.steps[scene], { measure: options.measure })
  } catch {
    const words = figureWords(definition, scene)
    return `<p class="unavailable">This figure could not be drawn.</p>${words.length ? `<ul>${words.map(word => `<li>${escape(word)}</li>`).join('')}</ul>` : ''}`
  }
  const root = annotate(drawing.svg, new Map(drawing.hotspots.map(h => [h.id, h])))
  root.attrs = { ...root.attrs, role: drawing.hotspots.length ? 'group' : 'img', 'aria-label': title }
  return svgMarkup(root, 1)
}

const fontFace = (url?: string) => url && /^data:[\w.+/-]+;base64,[A-Za-z0-9+/=]+$/.test(url)
  ? `@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;font-display:block;src:url(${url})}\n` : ''

const EXPORT_CSS = `
:root{--vx-card:#171821;--vx-canvas:#0e1016;--vx-hair:#2a2f3e;--vx-ink:#eceef4;--vx-muted:#9aa3b5;--vx-faint:#596275;--vx-primary:#8fa2ff;--vx-secondary:#45d0c1;--vx-accent:#f6bd4f;
  --vx-font:"Inter Variable",Inter,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;color-scheme:dark}
[hidden]{display:none!important}
*{box-sizing:border-box}
body{margin:0;background:var(--vx-card);color:var(--vx-ink);font:15px/1.55 var(--vx-font)}
main{max-width:720px;margin:auto;padding:28px 16px 40px}
.eyebrow{margin:0 0 4px;font-size:10.5px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:var(--vx-primary)}
h1{margin:0;font-size:24px;line-height:1.25;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
h2{font-size:15px;font-weight:650;margin:0 0 8px}
.summary{margin:8px 0 0;color:var(--vx-muted);font-size:14px}
.player{margin-top:18px;outline:none}
.player:focus-visible{outline:2px solid var(--vx-primary);outline-offset:6px;border-radius:12px}
.stage{border-radius:12px;background:var(--vx-canvas);border:1px solid var(--vx-hair);overflow:hidden}
.stage-head{display:flex;align-items:baseline;gap:8px;padding:10px 14px 0;font-size:12px;color:var(--vx-muted)}
.stage-head h2{margin:0;font-size:inherit;font-weight:600;color:var(--vx-ink)}
.stage-head span{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.canvas{padding:4px 0 6px}
.canvas svg{display:block;width:100%;height:auto;max-height:70vh;font-family:var(--vx-font)}
.unavailable{margin:14px;color:var(--vx-muted)}
.canvas ul{margin:0 14px 14px}
[data-detail]{cursor:pointer}
[data-detail]:focus-visible{outline:2px solid var(--vx-primary)}
.caption{margin:10px 0 0;font-size:16px;line-height:1.45;text-wrap:pretty}
.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--vx-muted)}
.basis{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--vx-hair);border-radius:99px;white-space:nowrap}
.basis::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--vx-faint)}
.basis[data-basis=source]::before{background:var(--vx-secondary)}
.basis[data-basis=illustration]::before{background:var(--vx-accent)}
.more{margin-top:10px;font-size:14px;color:var(--vx-muted)}
.more summary{cursor:pointer;color:var(--vx-primary);font-weight:550}
.more p{margin:6px 0 0;color:var(--vx-ink)}
.hint{margin:8px 0 0;font-size:12px;color:var(--vx-muted)}
.detail{margin:10px 0 0;padding:9px 12px;border-radius:8px;background:var(--vx-canvas);border:1px solid var(--vx-hair);font-size:14px}
.progress{display:flex;gap:10px;margin-top:14px}
.progress div{display:flex;gap:3px;flex:1 1 0}
.progress button{flex:1 1 0;height:16px;padding:6px 0;border:0;background:none;cursor:pointer}
.progress button::before{content:"";display:block;height:4px;border-radius:2px;background:var(--vx-hair);transition:background .2s}
.progress button.is-done::before{background:var(--vx-faint)}
.progress button.is-now::before{background:var(--vx-primary)}
nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding-top:12px;border-top:1px solid var(--vx-hair)}
nav span{font-size:13px;color:var(--vx-muted);font-variant-numeric:tabular-nums}
nav button{font:inherit;font-size:14px;font-weight:550;padding:6px 14px;border-radius:8px;border:1px solid var(--vx-hair);background:transparent;color:var(--vx-ink);cursor:pointer}
nav button#next{background:var(--vx-primary);border-color:var(--vx-primary);color:var(--vx-canvas)}
nav button:disabled{opacity:.35;cursor:default}
button:focus-visible{outline:2px solid var(--vx-primary);outline-offset:2px}
footer{border-top:1px solid var(--vx-hair);padding-top:16px;margin-top:28px;font-size:14px}
footer details{margin-top:10px;color:var(--vx-muted)}
footer summary{cursor:pointer;color:var(--vx-primary)}
.print-only{display:none}
@media print{
  :root{--vx-card:#fff;--vx-canvas:#f7f8fa;--vx-hair:#dfe3ea;--vx-ink:#1a1e2a;--vx-muted:#5b6475;--vx-faint:#a3aab8;--vx-primary:#3f51d9;--vx-secondary:#0b8a7f;--vx-accent:#ad6f0e;color-scheme:light}
  body{background:#fff;font-size:12pt}
  main{max-width:none;padding:0}
  .scene[hidden],.beat[hidden]{display:block!important}
  .scene{margin-top:22px}
  .stage{break-inside:avoid}
  .beat{break-inside:avoid;margin-top:10px}
  .print-only{display:inline}
  .canvas svg{max-height:none}
  .canvas svg .is-hidden{opacity:1!important;visibility:visible!important;transform:none!important}
  .progress,nav,.hint,.detail{display:none!important}
  .more summary{display:none}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`

// The only script in the export. It reads nothing from the model: frame order and reveal steps come from data-* attributes,
// and hotspot detail is written with textContent.
const EXPORT_SCRIPT = `(()=>{const $=s=>[...document.querySelectorAll(s)],frames=$('.beat'),scenes=$('.scene'),segments=$('.progress button'),previous=document.getElementById('previous'),next=document.getElementById('next'),counter=document.getElementById('counter'),detail=document.getElementById('detail'),hint=document.getElementById('hint');let index=0;
function show(i,focus){index=Math.max(0,Math.min(frames.length-1,i));const frame=frames[index],scene=Number(frame.dataset.scene),beat=Number(frame.dataset.beat);scenes.forEach((s,n)=>{s.hidden=n!==scene});frames.forEach((f,n)=>{f.hidden=n!==index});
scenes[scene].querySelectorAll('[data-at]').forEach(el=>{const hide=Number(el.getAttribute('data-at'))>beat;el.classList.toggle('is-hidden',hide);if(el.hasAttribute('data-detail'))el.setAttribute('tabindex',hide?'-1':'0')});
segments.forEach((b,n)=>{b.className=n===index?'is-now':n<index?'is-done':'';b.tabIndex=n===index?0:-1;if(n===index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});if(focus)segments[index].focus();
previous.disabled=index===0;next.disabled=index===frames.length-1;counter.textContent='Step '+(index+1)+' of '+frames.length;detail.hidden=true;hint.hidden=!scenes[scene].querySelector('[data-detail]')}
previous.onclick=()=>show(index-1);next.onclick=()=>show(index+1);segments.forEach((b,n)=>{b.onclick=()=>show(n)});
function reveal(target){const node=target.closest&&target.closest('[data-detail]');if(!node||node.classList.contains('is-hidden'))return false;const name=document.createElement('b');name.textContent=node.getAttribute('data-name')+'. ';detail.replaceChildren(name,document.createTextNode(node.getAttribute('data-detail')));detail.hidden=false;hint.hidden=true;return true}
document.addEventListener('click',e=>reveal(e.target));
document.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;if((e.key==='Enter'||e.key===' ')&&reveal(e.target)){e.preventDefault();return}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show(index+(e.key==='ArrowRight'?1:-1),segments.includes(document.activeElement))}});
let opened=[];function paper(on){const theme=on?'paper':'dark';document.documentElement.dataset.theme=theme;$('svg,.canvas').forEach(el=>el.setAttribute('data-theme',theme));if(on){opened=$('details:not([open])');opened.forEach(d=>d.open=true)}else{opened.forEach(d=>d.open=false);opened=[]}}
addEventListener('beforeprint',()=>paper(true));addEventListener('afterprint',()=>paper(false));show(0)})();`

export function visualHtml(record: VisualRecord, options: VisualHtmlOptions = {}): string {
  const v = record.definition
  if (!v) throw new Error('Wait for the completed explanation before exporting.')
  const layout = { measure: options.measure ?? approximateMeasure, width: options.width ?? 640 }
  const frames = visualFrames(v), scenes = sceneCount(v)
  const label = (ids: string[]) => ids.map(id => record.references.find(ref => ref.id === id)?.label || id)
  const sceneHtml = Array.from({ length: scenes }, (_, s) => {
    const members = frames.map((frame, k) => ({ frame, k })).filter(({ frame }) => frame.scene === s)
    const title = members[0]?.frame.sceneTitle ?? ''
    return `<section class="scene" data-scene="${s}"${s ? ' hidden' : ''}>
<div class="stage"><div class="stage-head"><span>${s + 1} / ${scenes}</span><h2>${escape(title)}</h2></div><div class="canvas">${figureMarkup(v, s, `Figure ${s + 1}: ${title}`, layout)}</div></div>
${members.map(({ frame, k }) => `<div class="beat" data-frame="${k}" data-scene="${s}" data-beat="${frame.beat}"${k ? ' hidden' : ''}><p class="caption"><span class="print-only">${k + 1}. </span>${escape(frame.caption)}</p><div class="meta"><span class="basis" data-basis="${escape(frame.basis)}">${visualBasisLabel(frame.basis)}</span>${frame.referenceIds.length ? `<span>${label(frame.referenceIds).map(escape).join(' · ')}</span>` : ''}</div><details class="more"><summary>Read more</summary><p>${escape(frame.explanation)}</p></details></div>`).join('\n')}
</section>`
  }).join('\n')
  const progress = Array.from({ length: scenes }, (_, s) => `<div style="flex-grow:${frames.filter(frame => frame.scene === s).length}">${frames.map((frame, k) => frame.scene === s
    ? `<button type="button" aria-label="Step ${k + 1} of ${frames.length}: figure ${s + 1}${frame.beats > 1 ? `, part ${frame.beat} of ${frame.beats}` : ''}"></button>` : '').join('')}</div>`).join('')
  return `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(v.title)}</title>
<style>${fontFace(options.fontDataUrl)}${VISUAL_KIT_CSS}
${EXPORT_CSS}</style>
<main><header><p class="eyebrow">pdfpal · Explain visually</p><h1>${escape(v.title)}</h1><p class="summary">${escape(v.summary)}</p></header>
<div class="player" tabindex="0" aria-label="Use the left and right arrow keys to move between steps">
${sceneHtml}
<p class="hint" id="hint" hidden>Items marked with a dot have more to say. Select one.</p><p class="detail" id="detail" aria-live="polite" hidden></p>
<div class="progress" role="group" aria-label="Steps">${progress}</div>
<nav><button type="button" id="previous" aria-label="Previous" disabled>← Back</button><span id="counter">Step 1 of ${frames.length}</span><button type="button" id="next" aria-label="Next"${frames.length > 1 ? '' : ' disabled'}>Next →</button></nav>
</div>
<footer>${v.takeaways.length ? `<h2>Takeaways</h2><ul>${v.takeaways.map(text => `<li>${escape(text)}</li>`).join('')}</ul>` : ''}${record.references.length ? `<details><summary>Sources</summary><ul>${record.references.map(ref => `<li>${escape(ref.label)}</li>`).join('')}</ul></details>` : ''}</footer></main>
<script>${EXPORT_SCRIPT}</script></html>`
}

export function downloadVisual(record: VisualRecord, options: VisualHtmlOptions = {}) {
  const url = URL.createObjectURL(new Blob([visualHtml(record, options)], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `${record.definition!.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 80) || 'visual-explanation'}.html`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
