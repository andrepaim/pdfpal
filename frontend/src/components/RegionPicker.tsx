// Choosing a region of a PDF page for a post. "Share a region" reads the page's text layer, opens the crop editor on
// a box in the middle of the page and hands back the chosen box with the text inside it. "Share the paper" needs no
// choice: readFirstPage works out the first page's title, authors and abstract box and its text in one step. See
// "Region and first-page posts (T5)" and "Stage 5: share the paper" in docs/share-posts-plan.md.
import { useEffect, useState } from 'react'
import type { PageMark, PageRect } from '../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../lib/pdf-document'
import { MIDDLE_REGION, firstPageRegion, pageTextRuns, regionText, type TextRun } from '../lib/share-card/region-text'
import CropEditor, { CROP_PAGE_UNAVAILABLE } from './CropEditor'

/** What a region or paper post starts from: the page, the box as page fractions and the text read inside it. */
export type RegionChoice = { page: number; region: PageRect; text: string }

/**
 * The first page's title, authors and abstract (everything above the first section heading), and the text inside
 * that box, for "Share the paper". Throws Error(CROP_PAGE_UNAVAILABLE) when the page cannot be read.
 */
export async function readFirstPage(fileUrl: string): Promise<RegionChoice> {
  const task = pdfjs.getDocument({ url: fileUrl, ...PDF_OPTIONS })
  try {
    const proxy = await (await task.promise).getPage(1)
    const base = proxy.getViewport({ scale: 1 })
    const size = { width: base.width, height: base.height }
    const runs = await pageTextRuns(proxy)
    const region = firstPageRegion(runs, size)
    return { page: 1, region, text: regionText(runs, region, size) }
  } catch {
    throw new Error(CROP_PAGE_UNAVAILABLE)
  } finally {
    void task.destroy().catch(() => {})
  }
}

type Props = {
  fileUrl: string
  /** The page to choose on, read once when the picker opens. */
  page: number
  /** The reader's highlights on that page, drawn in the editor; read once when the picker opens. */
  marks?: PageMark[]
  onCreate: (choice: RegionChoice) => void
  onCancel: () => void
  /** The page could not be loaded; the message is for the reader. */
  onError: (message: string) => void
}

/** The page's text and size, kept with the page they were read from so the text sent always belongs to the page sent. */
type Loaded = { page: number; runs: TextRun[]; size: { width: number; height: number } }

export default function RegionPicker({ fileUrl, page, marks = [], onCreate, onCancel, onError }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // The page in view when the reader chose "Share a region", and its marks. The reader may scroll behind the modal;
  // the picker never follows, so the box, the text and the page sent all belong to this page.
  const [opened] = useState(() => ({ page, marks }))
  const number = opened.page

  // Read the page's text first, so the text sent is the text inside the chosen box.
  useEffect(() => {
    let cancelled = false
    const task = pdfjs.getDocument({ url: fileUrl, ...PDF_OPTIONS })
    task.promise.then(document => document.getPage(number)).then(async proxy => {
      const base = proxy.getViewport({ scale: 1 })
      const runs = await pageTextRuns(proxy)
      if (!cancelled) setLoaded({ page: number, runs, size: { width: base.width, height: base.height } })
    }).catch(() => { if (!cancelled) onError(CROP_PAGE_UNAVAILABLE) })
    return () => { cancelled = true; void task.destroy().catch(() => {}) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, number])

  if (!loaded) return <span role="status" style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" aria-hidden="true" /> Loading page…</span>
  return (
    <CropEditor fileUrl={fileUrl} page={loaded.page} value={MIDDLE_REGION} marks={opened.marks} title="Choose a region" applyLabel="Create post" resetLabel={null}
      onCancel={onCancel}
      onApply={region => { if (region) onCreate({ page: loaded.page, region, text: regionText(loaded.runs, region, loaded.size) }) }} />
  )
}
