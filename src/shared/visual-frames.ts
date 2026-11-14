// The player's frames. Kept free of runtime imports (zod in particular): the web app and the Kindle side panel bundle
// this module, and only types come from the schema module.
import type { VisualDefinition } from './visual.js'

/** One frame of the player: v1 has one frame per step; v2 has one frame per beat, grouped by scene. */
export type VisualFrame = {
  scene: number; beat: number; beats: number; sceneTitle: string;
  caption: string; explanation: string; basis: 'source' | 'illustration' | 'background'; referenceIds: string[];
}
export function visualFrames(definition: VisualDefinition): VisualFrame[] {
  if (definition.version === 1) return definition.steps.map((step, scene) => ({ scene, beat: 1, beats: 1, sceneTitle: step.title.replace(/^\d+[.)]\s+/, ''),
    caption: step.caption, explanation: step.explanation, basis: step.basis, referenceIds: step.referenceIds }))
  return definition.scenes.flatMap((scene, index) => scene.beats.map((beat, b) => ({ scene: index, beat: b + 1, beats: scene.beats.length, sceneTitle: scene.title,
    caption: beat.caption, explanation: beat.explanation, basis: beat.basis, referenceIds: beat.referenceIds })))
}
