// The share card's bundled fonts (frontend/public/fonts, SIL Open Font License 1.1). Cards are drawn only after
// every face has loaded, so measurements and pixels never use a fallback by accident.
const FACES: Array<{ family: string; file: string; weight: string; style: string }> = [
  { family: 'Inter', file: 'inter_regular', weight: '400', style: 'normal' },
  { family: 'Inter', file: 'inter_semibold', weight: '600', style: 'normal' },
  { family: 'Inter', file: 'inter_bold', weight: '700', style: 'normal' },
  { family: 'Newsreader', file: 'newsreader_regular', weight: '400', style: 'normal' },
  { family: 'Newsreader', file: 'newsreader_italic', weight: '400', style: 'italic' },
]

let loading: Promise<void> | undefined

/** Resolves once all five faces are registered and loaded. A failure is not cached, so a later call retries. */
export function loadCardFonts(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve()
  loading ??= Promise.all(FACES.map(async ({ family, file, weight, style }) => {
    const face = new FontFace(family, `url("/fonts/${file}.ttf") format("truetype")`, { weight, style, display: 'block' })
    await face.load()
    document.fonts.add(face)
  })).then(() => undefined, error => { loading = undefined; throw error })
  return loading
}
