import { z } from 'zod'

const color = z.enum(['indigo', 'teal', 'amber', 'rose', 'slate'])
const point = z.number().finite().min(0).max(600)
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
const common = { id, color, detail: z.string().max(800).optional() }
export const visualElement = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('node'), x: point, y: point, width: z.number().min(32).max(340), height: z.number().min(32).max(240), label: z.string().min(1).max(64), shape: z.enum(['box', 'ellipse']).default('box') }).strict(),
  z.object({ ...common, type: z.literal('arrow'), x1: point, y1: point, x2: point, y2: point, label: z.string().max(32).optional() }).strict(),
  z.object({ ...common, type: z.literal('text'), x: point, y: point, text: z.string().min(1).max(90), size: z.number().min(16).max(28).default(18) }).strict(),
  z.object({ ...common, type: z.literal('path'), points: z.array(z.object({ x: point, y: point }).strict()).min(2).max(60), closed: z.boolean().default(false) }).strict(),
])
export const visualDefinitionV1 = z.object({
  version: z.literal(1), title: z.string().min(1).max(120), summary: z.string().min(1).max(500),
  steps: z.array(z.object({
    title: z.string().min(1).max(100), caption: z.string().min(1).max(400), explanation: z.string().min(1).max(2200),
    basis: z.enum(['source', 'illustration', 'background']), referenceIds: z.array(z.string().max(100)).max(12).default([]),
    scene: z.object({ height: z.number().min(240).max(600), elements: z.array(visualElement).min(2).max(60) }).strict(),
  }).strict()).min(2).max(8),
  takeaways: z.array(z.string().min(1).max(300)).min(1).max(4),
}).strict().superRefine((value, ctx) => {
  for (const [index, step] of value.steps.entries()) {
    const ids = new Set<string>()
    for (const element of step.scene.elements) {
      const bad = ids.has(element.id) || (element.type === 'node'
        ? element.x + element.width > 360 || element.y + element.height > step.scene.height
        : element.type === 'arrow' ? Math.max(element.x1, element.x2) > 360 || Math.max(element.y1, element.y2) > step.scene.height
        : element.type === 'text' ? element.x > 360 || element.y > step.scene.height
        : element.points.some(p => p.x > 360 || p.y > step.scene.height))
      if (bad) ctx.addIssue({ code: 'custom', path: ['steps', index, 'scene'], message: 'Use unique element IDs and keep every shape inside the 360-wide scene.' })
      ids.add(element.id)
    }
    if (step.basis === 'source' && !step.referenceIds.length) ctx.addIssue({ code: 'custom', path: ['steps', index, 'referenceIds'], message: 'Source-based steps need a supplied reference.' })
  }
})
export type VisualDefinitionV1 = z.infer<typeof visualDefinitionV1>
export type VisualStepV1 = VisualDefinitionV1['steps'][number]
export type VisualElement = z.infer<typeof visualElement>

// ---------------------------------------------------------------------------------------------------------------------
// Format version 2. The assistant chooses a figure kind and supplies content and data; the app owns every position,
// size, font and colour (src/shared/visual-kit). Plot marks carry data coordinates in the units of the plot's axes.
// Parsing is lenient where leniency is harmless: over-long text is shortened, unknown keys are dropped, a bad tone
// becomes the default, edges to missing nodes are dropped. Anything that would draw wrongly fails its scene instead.
// ---------------------------------------------------------------------------------------------------------------------
export const visualTones = ['neutral', 'primary', 'secondary', 'accent', 'positive', 'negative'] as const
export type VisualTone = typeof visualTones[number]
const clip = (max: number) => z.string().trim().min(1).transform(text => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const optionalClip = (max: number) => z.string().trim().transform(text => text ? (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text) : undefined).optional()
const tone = z.enum(visualTones).optional().catch(undefined)
const appear = z.number().int().min(1).max(12).optional().catch(undefined)
const itemId = z.string().trim().min(1).max(60)
const optionalId = itemId.optional().catch(undefined)
const finite = z.number().finite()
const xy = z.tuple([finite, finite])
const flag = z.boolean().optional().catch(undefined)
const drawn = { tone, appear }

export const visualBeat = z.object({
  caption: clip(240), explanation: clip(1200),
  basis: z.enum(['source', 'illustration', 'background']).catch('illustration'),
  referenceIds: z.array(z.string().max(100)).max(12).default([]),
}).transform(beat => beat.basis === 'source' && !beat.referenceIds.length ? { ...beat, basis: 'background' as const } : beat)

const flowScene = z.object({
  kind: z.literal('flow'), direction: z.enum(['down', 'right']).optional().catch(undefined),
  nodes: z.array(z.object({ id: itemId, label: clip(48), sub: optionalClip(60), shape: z.enum(['box', 'pill', 'op']).optional().catch(undefined),
    group: z.string().max(60).optional().catch(undefined), detail: optionalClip(400), ...drawn })).min(1).max(12),
  edges: z.array(z.object({ from: itemId, to: itemId, label: optionalClip(32), dashed: flag, ...drawn })).max(24).default([]),
  groups: z.array(z.object({ id: itemId, label: clip(40) })).max(4).optional(),
})
const markBase = { id: optionalId, ...drawn }
const plotMark = z.discriminatedUnion('type', [
  z.object({ ...markBase, type: z.literal('curve'), points: z.array(xy).min(2).max(40), label: optionalClip(40), labelAt: z.enum(['start', 'end', 'peak']).optional().catch(undefined), dashed: flag }),
  z.object({ ...markBase, type: z.literal('line'), from: xy, to: xy, label: optionalClip(40), labelAt: z.enum(['end', 'mid']).optional().catch(undefined), dashed: flag }),
  z.object({ ...markBase, type: z.literal('vector'), from: xy, to: xy, label: optionalClip(40) }),
  z.object({ ...markBase, type: z.literal('point'), xy, label: optionalClip(40) }),
  z.object({ ...markBase, type: z.literal('area'), points: z.array(xy).min(3).max(40), label: optionalClip(40) }),
  z.object({ ...markBase, type: z.literal('circle'), center: xy, r: z.number().finite().positive(), label: optionalClip(40), dashed: flag }),
  z.object({ ...markBase, type: z.literal('angle'), vertex: xy, from: xy, to: xy, label: optionalClip(24) }),
  z.object({ ...markBase, type: z.literal('note'), xy, text: clip(48) }),
])
const axis = z.object({ label: optionalClip(40), min: finite, max: finite, ticks: z.array(z.object({ at: finite, label: clip(14) })).max(12).optional() })
  .refine(a => a.max > a.min, 'An axis needs max greater than min.')
const plotScene = z.object({ kind: z.literal('plot'), x: axis, y: axis, axes: flag, equal: flag, marks: z.array(plotMark).min(1).max(14) })
const barsScene = z.object({
  kind: z.literal('bars'), label: optionalClip(60), unit: optionalClip(16),
  items: z.array(z.object({ id: itemId, label: clip(32), value: finite, display: optionalClip(16), note: optionalClip(40), ...drawn })).min(2).max(8),
})
const slot = z.number().int().min(0).max(15)
const cellsScene = z.object({
  kind: z.literal('cells'),
  rows: z.array(z.object({ id: itemId, label: optionalClip(24), offset: slot.optional().catch(undefined), ...drawn,
    cells: z.array(z.object({ text: z.string().trim().max(40).transform(text => text.length > 8 ? `${text.slice(0, 7)}…` : text),
      span: z.number().int().min(1).max(12).optional().catch(undefined), weight: z.number().min(0).max(1).optional().catch(undefined), ...drawn })).min(1).max(12) })).min(1).max(5),
  brackets: z.array(z.object({ row: itemId, from: slot, to: slot, label: optionalClip(32), ...drawn })).max(8).optional(),
  links: z.array(z.object({ from: z.tuple([itemId, slot]), to: z.tuple([itemId, slot]), label: optionalClip(32), ...drawn })).max(12).optional(),
})
const compareScene = z.object({
  kind: z.literal('compare'),
  columns: z.array(z.object({ id: itemId, title: clip(32), tone })).min(2).max(3),
  rows: z.array(z.object({ label: clip(24), cells: z.array(z.string().trim().max(200).transform(text => text.length > 80 ? `${text.slice(0, 79)}…` : text)).min(1).max(3), appear })).min(1).max(6),
})
const quadrantEnd = z.object({ low: clip(28), high: clip(28) })
const quadrantScene = z.object({
  kind: z.literal('quadrant'), x: quadrantEnd, y: quadrantEnd,
  items: z.array(z.object({ id: itemId, label: clip(32), sub: optionalClip(40), quadrant: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    detail: optionalClip(400), ...drawn })).min(1).max(8),
})
const sceneBase = { title: clip(70), beats: z.array(visualBeat).min(1).max(6) }
export const visualSceneV2 = z.discriminatedUnion('kind', [
  flowScene.extend(sceneBase), plotScene.extend(sceneBase), barsScene.extend(sceneBase),
  cellsScene.extend(sceneBase), compareScene.extend(sceneBase), quadrantScene.extend(sceneBase),
]).superRefine((scene, ctx) => {
  const unique = (ids: (string | undefined)[], what: string) => {
    const seen = new Set<string>()
    for (const id of ids) if (id !== undefined) { if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Duplicate ${what} id "${id}".` }); seen.add(id) }
  }
  if (scene.kind === 'flow') unique(scene.nodes.map(n => n.id), 'node')
  if (scene.kind === 'plot') unique(scene.marks.map(m => m.id), 'mark')
  if (scene.kind === 'bars') unique(scene.items.map(i => i.id), 'bar')
  if (scene.kind === 'cells') unique(scene.rows.map(r => r.id), 'row')
  if (scene.kind === 'compare') { unique(scene.columns.map(c => c.id), 'column'); if (scene.rows.some(r => r.cells.length !== scene.columns.length)) ctx.addIssue({ code: 'custom', message: 'Each comparison row needs one cell per column.' }) }
  if (scene.kind === 'quadrant') unique(scene.items.map(i => i.id), 'item')
}).transform(scene => {
  // Drop references to things that do not exist rather than failing the whole figure.
  if (scene.kind === 'flow') {
    const ids = new Set(scene.nodes.map(n => n.id))
    return { ...scene, edges: scene.edges.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to) }
  }
  if (scene.kind === 'cells') {
    const width = new Map(scene.rows.map(r => [r.id, r.cells.length]))
    const fits = ([row, index]: [string, number]) => (width.get(row) ?? 0) > index
    return { ...scene, brackets: scene.brackets?.filter(b => width.has(b.row) && b.from <= b.to && fits([b.row, b.to])), links: scene.links?.filter(l => fits(l.from) && fits(l.to)) }
  }
  return scene
})
export const visualDefinitionV2 = z.object({
  version: z.literal(2), title: clip(120), summary: clip(300),
  scenes: z.array(visualSceneV2).min(1).max(5),
  takeaways: z.array(clip(300)).max(4).default([]),
})
export type VisualSceneV2 = z.infer<typeof visualSceneV2>
export type VisualBeat = z.infer<typeof visualBeat>
export type VisualDefinitionV2 = z.infer<typeof visualDefinitionV2>
export type VisualDefinition = VisualDefinitionV1 | VisualDefinitionV2
/** Accepts either stored format. */
export const visualDefinition = z.union([visualDefinitionV1, visualDefinitionV2])

/**
 * Parses an assistant answer in format 2, keeping every scene that validates. Throws with a readable message when the
 * envelope is wrong or no scene survives; `dropped` describes scenes that were left out.
 */
export function parseVisualDefinitionV2(value: unknown): { definition: VisualDefinitionV2; dropped: string[] } {
  const envelope = z.object({ version: z.literal(2), scenes: z.array(z.unknown()).min(1).max(8) }).passthrough().safeParse(value)
  if (!envelope.success) throw new Error(`Not a version 2 explanation: ${z.prettifyError(envelope.error)}`)
  const dropped: string[] = [], scenes: unknown[] = []
  for (const [index, scene] of envelope.data.scenes.entries()) {
    const result = visualSceneV2.safeParse(scene)
    if (result.success) scenes.push(scene)
    else dropped.push(`Figure ${index + 1}: ${z.prettifyError(result.error).replace(/\s+/g, ' ').slice(0, 400)}`)
  }
  if (!scenes.length) throw new Error(`No figure met the format. ${dropped.join(' ')}`)
  const result = visualDefinitionV2.safeParse({ ...envelope.data, scenes: scenes.slice(0, 5) })
  if (!result.success) throw new Error(z.prettifyError(result.error).replace(/\s+/g, ' ').slice(0, 600))
  return { definition: result.data, dropped }
}

// Frames live in a zod-free module so the browser bundles do not pull in the schema library.
export { visualFrames, type VisualFrame } from './visual-frames.js'
import type { VisualFrame } from './visual-frames.js'
export type VisualReference = { id: string; label: string }
export type VisualRecord = {
  id: string; project_id: string; question: string; status: 'pending' | 'running' | 'complete' | 'failed';
  definition: VisualDefinition | null; references: VisualReference[]; error: string | null; note_id: string | null; created_at: string;
}

const basisLabel = (basis: VisualFrame['basis']) => basis === 'source' ? 'Based on supplied text' : basis === 'illustration' ? 'Illustrative example' : 'Background knowledge'
const sourcesLine = (ids: string[], references: VisualReference[]) => ids.length ? `\n\nSources: ${ids.map(id => references.find(ref => ref.id === id)?.label || id).join('; ')}` : ''
/** Plain-text words a v2 figure carries that a reader without the picture would need. */
function sceneWords(scene: VisualSceneV2): string[] {
  if (scene.kind === 'flow') return scene.nodes.map(n => `- ${n.label}${n.sub ? ` (${n.sub})` : ''}${n.detail ? `: ${n.detail}` : ''}`)
  if (scene.kind === 'quadrant') return scene.items.map(i => `- ${i.label} (${scene.y[i.quadrant.startsWith('top') ? 'high' : 'low']}, ${scene.x[i.quadrant.endsWith('right') ? 'high' : 'low']})${i.detail ? `: ${i.detail}` : ''}`)
  if (scene.kind === 'bars') return scene.items.map(i => `- ${i.label}: ${i.display ?? `${i.value}${scene.unit ? ` ${scene.unit}` : ''}`}${i.note ? ` (${i.note})` : ''}`)
  if (scene.kind === 'compare') return [`| | ${scene.columns.map(c => c.title).join(' | ')} |`, `|---|${scene.columns.map(() => '---').join('|')}|`, ...scene.rows.map(r => `| ${r.label} | ${r.cells.join(' | ')} |`)]
  return []
}

export function visualTranscript(visual: VisualDefinition, references: VisualReference[] = []): string {
  const head = `# ${visual.title}\n\n${visual.summary}\n\n`, tail = `\n\n## Takeaways\n\n${visual.takeaways.map(text => `- ${text}`).join('\n')}`
  if (visual.version === 2) return head + visual.scenes.map((scene, i) => {
    const words = sceneWords(scene)
    return `## ${i + 1}. ${scene.title}\n\n` + scene.beats.map(beat => `*${basisLabel(beat.basis)}*\n\n${beat.caption}\n\n${beat.explanation}${sourcesLine(beat.referenceIds, references)}`).join('\n\n') + (words.length ? `\n\n${words.join('\n')}` : '')
  }).join('\n\n') + tail
  return head + visual.steps.map((step, i) =>
    `## ${i + 1}. ${step.title.replace(/^\d+[.)]\s+/, '')}\n\n*${basisLabel(step.basis)}*\n\n${step.caption}\n\n${step.explanation}\n\n${step.scene.elements.flatMap(e => e.type === 'node' ? [`- ${e.label}${e.detail ? `: ${e.detail}` : ''}`] : []).join('\n')}${sourcesLine(step.referenceIds, references)}`
  ).join('\n\n') + tail
}
