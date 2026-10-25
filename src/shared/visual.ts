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
export const visualDefinition = z.object({
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
export type VisualDefinition = z.infer<typeof visualDefinition>
export type VisualElement = z.infer<typeof visualElement>
export type VisualReference = { id: string; label: string }
export type VisualRecord = {
  id: string; project_id: string; question: string; status: 'pending' | 'running' | 'complete' | 'failed';
  definition: VisualDefinition | null; references: VisualReference[]; error: string | null; note_id: string | null; created_at: string;
}

export function visualTranscript(visual: VisualDefinition, references: VisualReference[] = []): string {
  return `# ${visual.title}\n\n${visual.summary}\n\n` + visual.steps.map((step, i) =>
    `## ${i + 1}. ${step.title.replace(/^\d+[.)]\s+/, '')}\n\n*${step.basis === 'source' ? 'Based on supplied text' : step.basis === 'illustration' ? 'Illustrative example' : 'Background knowledge'}*\n\n${step.caption}\n\n${step.explanation}\n\n${step.scene.elements.flatMap(e => e.type === 'node' ? [`- ${e.label}${e.detail ? `: ${e.detail}` : ''}`] : []).join('\n')}${step.referenceIds.length ? `\n\nSources: ${step.referenceIds.map(id => references.find(ref => ref.id === id)?.label || id).join('; ')}` : ''}`
  ).join('\n\n') + `\n\n## Takeaways\n\n${visual.takeaways.map(text => `- ${text}`).join('\n')}`
}
