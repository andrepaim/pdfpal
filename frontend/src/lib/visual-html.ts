import type { VisualElement, VisualRecord } from '../../../src/shared/visual'

export const visualColors = { indigo: '#a5b4fc', teal: '#5eead4', amber: '#fcd34d', rose: '#fda4af', slate: '#cbd5e1' }
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
export function arrowHead(e: Extract<VisualElement, { type: 'arrow' }>): string {
  const angle = Math.atan2(e.y2 - e.y1, e.x2 - e.x1), size = 8
  return `${e.x2},${e.y2} ${e.x2 - size * Math.cos(angle - .5)},${e.y2 - size * Math.sin(angle - .5)} ${e.x2 - size * Math.cos(angle + .5)},${e.y2 - size * Math.sin(angle + .5)}`
}
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
function elementHtml(e: VisualElement): string {
  const color = visualColors[e.color]
  if (e.type === 'node') {
    const lines = wrapLabel(e.label, e.width)
    const shape = e.shape === 'ellipse' ? `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}"/>`
      : `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="12"/>`
    return `<g ${e.detail ? `role="button" tabindex="0" aria-label="${escape(e.label)}" data-detail="${escape(e.detail)}"` : ''} style="color:${color}"><g fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="1.5">${shape}</g><text fill="#f1f5f9" font-size="18" text-anchor="middle">${lines.map((line, i) => `<tspan x="${e.x + e.width / 2}" y="${e.y + e.height / 2 + (i - (lines.length - 1) / 2) * 22 + 6}">${escape(line)}</tspan>`).join('')}</text></g>`
  }
  if (e.type === 'text') return `<text x="${e.x}" y="${e.y}" fill="${color}" stroke="#10121c" stroke-width="4" paint-order="stroke" stroke-linejoin="round" font-size="${e.size}" text-anchor="middle">${escape(e.text)}</text>`
  if (e.type === 'path') return `<path d="${e.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}${e.closed ? ' Z' : ''}" fill="${e.closed ? color : 'none'}" fill-opacity=".15" stroke="${color}" stroke-width="2.5"/>`
  return `<g stroke="${color}" fill="${color}"><line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke-width="2"/><polygon points="${arrowHead(e)}"/>${e.label ? `<text x="${(e.x1 + e.x2) / 2}" y="${(e.y1 + e.y2) / 2 - 10}" stroke="none" font-size="16" text-anchor="middle">${escape(e.label)}</text>` : ''}</g>`
}

export function visualHtml(record: VisualRecord): string {
  const v = record.definition
  if (!v) throw new Error('Wait for the completed explanation before exporting.')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(v.title)}</title>
<style>body{margin:0;background:#101116;color:#e2e8f0;font:16px/1.6 system-ui,sans-serif}main{max-width:720px;margin:auto;padding:24px}h1{line-height:1.2}button{font:inherit;background:#252640;color:#e2e8f0;border:1px solid #6366f1;border-radius:8px;padding:7px 14px;cursor:pointer}button:disabled{opacity:.4}nav{display:flex;align-items:center;justify-content:space-between;gap:12px}svg{display:block;width:100%;max-height:65vh;background:#151722;border-radius:16px;font-family:system-ui,sans-serif}g[role=button]{cursor:pointer}g[role=button]:focus{outline:2px solid #a5b4fc}figcaption{margin-top:12px}figure{margin:18px 0}small{color:#94a3b8}#detail{padding:12px;border-left:3px solid #818cf8}footer{border-top:1px solid #333;padding-top:16px;margin-top:24px}@media print{.v-export-step[hidden]{display:block!important}nav{display:none}svg{max-height:none}figure{break-inside:avoid}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style>
<main><small>pdfpal · Visual explanation</small><h1>${escape(v.title)}</h1><p>${escape(v.summary)}</p><nav><button id="previous" disabled>Previous</button><span id="counter">1 / ${v.steps.length}</span><button id="next">Next</button></nav>
${v.steps.map((step, i) => `<section class="v-export-step"${i ? ' hidden' : ''}><h2>${i + 1}. ${escape(step.title.replace(/^\d+[.)]\s+/, ''))}</h2><small>${escape(step.basis === 'source' ? 'Based on supplied text' : step.basis === 'illustration' ? 'Illustrative example' : 'Background knowledge')}</small><figure><svg viewBox="0 0 360 ${step.scene.height}" role="group" aria-label="${escape(step.title)}">${step.scene.elements.map(elementHtml).join('')}</svg><figcaption>${escape(step.caption)}</figcaption></figure><details><summary>Read the explanation</summary><p>${escape(step.explanation)}</p></details>${step.referenceIds.length ? `<p><small>${step.referenceIds.map(id => escape(record.references.find(ref => ref.id === id)?.label || '')).join('; ')}</small></p>` : ''}</section>`).join('')}
<p id="detail" aria-live="polite" hidden></p><footer><h2>Takeaways</h2><ul>${v.takeaways.map(text => `<li>${escape(text)}</li>`).join('')}</ul><details><summary>Sources</summary><ul>${record.references.map(ref => `<li>${escape(ref.label)}</li>`).join('')}</ul></details></footer></main>
<script>(()=>{let index=0;const steps=[...document.querySelectorAll('.v-export-step')],previous=document.getElementById('previous'),next=document.getElementById('next'),detail=document.getElementById('detail');function show(i){index=i;steps.forEach((s,n)=>s.hidden=n!==i);previous.disabled=i===0;next.disabled=i===steps.length-1;document.getElementById('counter').textContent=(i+1)+' / '+steps.length;detail.hidden=true}previous.onclick=()=>show(index-1);next.onclick=()=>show(index+1);function reveal(e){const node=e.target.closest('[data-detail]');if(node){detail.textContent=node.dataset.detail;detail.hidden=false}}document.addEventListener('click',reveal);document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-detail]')){e.preventDefault();reveal(e)}})})();</script></html>`
}

export function downloadVisual(record: VisualRecord) {
  const url = URL.createObjectURL(new Blob([visualHtml(record)], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `${record.definition!.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 80) || 'visual-explanation'}.html`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
