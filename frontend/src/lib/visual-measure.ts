// CONTRACT STUB — the renderer work replaces this with a canvas measurer that uses the bundled Inter font.
import { approximateMeasure, type Measure } from '../../../src/shared/visual-kit'

/** Resolves once the bundled Inter font is registered and loaded (document.fonts), so measurements are final. */
export async function ensureVisualFont(): Promise<void> {}
/** Measures text in Inter on a canvas; falls back to the approximate measurer where no canvas exists. */
export const measureVisualText: Measure = approximateMeasure
/** The bundled font as a data: URL, for embedding into exported HTML. */
export async function visualFontDataUrl(): Promise<string | undefined> { return undefined }
