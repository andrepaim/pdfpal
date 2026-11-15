// /dev/crop-editor: the crop editor on a PDF from the running app's library, for review and the browser test
// (frontend/e2e/crop-editor.spec.ts). Hidden: loaded lazily and linked from nowhere.
//   ?project=<id>&source=<id>   the source whose PDF is shown (required)
//   &page=<n>                   the page, 1 by default
//   &crop=x1,y1,x2,y2           the crop to start from, as page fractions
// The marks are fixed: they sit on the lines of page 2 of test/fixtures/share-cards.pdf. The last result is printed
// in [data-crop-result] as "applied x1,y1,x2,y2", "automatic" or "cancelled".
import { useMemo, useState } from 'react'
import type { PageMark, PageRect } from '../../../src/shared/share-card'
import CropEditor from '../components/CropEditor'
import { cropAttribute } from '../lib/share-card/crop-edit'

/** Stands in for the automatic crop a post would start from. */
const AUTOMATIC: PageRect = { x1: 0.08, y1: 0.06, x2: 0.92, y2: 0.24 }
/** Line boxes of page 2 of test/fixtures/share-cards.pdf, from pdf.js text positions. */
const LINE = (top: number, right: number): PageRect => ({ x1: 0.121, y1: top, x2: right, y2: top + 0.0142 })
const MARKS: PageMark[] = [
  { color: 'yellow', rects: [LINE(0.1056, 0.7058), LINE(0.1246, 0.7182)] },
  { color: 'green', rects: [LINE(0.1626, 0.7024)] },
  { color: 'pink', rects: [LINE(0.2006, 0.6532)] },
]

function parseCrop(text: string | null): PageRect | null {
  const values = text?.split(',').map(Number)
  if (!values || values.length !== 4 || values.some(value => !Number.isFinite(value))) return null
  const [x1, y1, x2, y2] = values as [number, number, number, number]
  return { x1, y1, x2, y2 }
}

export default function CropEditorSample() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const project = params.get('project'), source = params.get('source')
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [value, setValue] = useState<PageRect>(() => parseCrop(params.get('crop')) ?? AUTOMATIC)
  const [open, setOpen] = useState(true)
  const [result, setResult] = useState('')
  const fileUrl = project && source ? `/api/projects/${encodeURIComponent(project)}/sources/${encodeURIComponent(source)}/file` : null
  return (
    <main style={{ padding: 24, background: '#202024', minHeight: '100vh', color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Crop editor sample</h1>
      {!fileUrl ? <p>Add ?project=…&amp;source=… to the address.</p> : <>
        <p style={{ fontSize: 13 }}>Crop: <code data-crop-value>{cropAttribute(value)}</code></p>
        <p style={{ fontSize: 13 }}>Result: <output data-crop-result>{result}</output></p>
        <button onClick={() => setOpen(true)}>Open crop editor</button>
        {open && (
          <CropEditor fileUrl={fileUrl} page={page} value={value} marks={MARKS}
            onApply={crop => {
              setOpen(false)
              setResult(crop ? `applied ${cropAttribute(crop)}` : 'automatic')
              setValue(crop ?? AUTOMATIC)
            }}
            onCancel={() => { setOpen(false); setResult('cancelled') }} />
        )}
      </>}
    </main>
  )
}
