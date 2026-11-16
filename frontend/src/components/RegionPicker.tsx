// Choosing a region of a PDF page for a post: "Share a region" on the page being read, or "Share the first page". It
// reads the page's text layer, opens the crop editor on a starting box (the middle of the page, or the title, authors
// and abstract), and hands back the chosen box with the text inside it. See "Region and first-page posts (T5)" in
// docs/share-posts-plan.md.
import { useEffect, useState } from 'react'
import type { PageMark, PageRect } from '../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../lib/pdf-document'
import { MIDDLE_REGION, firstPageRegion, pageTextRuns, regionText, type TextRun } from '../lib/share-card/region-text'
import CropEditor, { CROP_PAGE_UNAVAILABLE } from './CropEditor'

export type RegionKind = 'region' | 'paper'
export const REGION_TITLES: Record<RegionKind, string> = { region: 'Choose a region', paper: 'Share the first page' }

type Props = {
  fileUrl: string
  /** The page to choose on; a first-page post always uses page 1. */
  page: number
  kind: RegionKind
  /** The reader's highlights on that page, drawn in the editor. */
  marks?: PageMark[]
  onCreate: (choice: { page: number; region: PageRect; text: string }) => void
  onCancel: () => void
  /** The page could not be loaded; the message is for the reader. */
  onError: (message: string) => void
}

type Loaded = { runs: TextRun[]; size: { width: number; height: number }; start: PageRect }

export default function RegionPicker({ fileUrl, page, kind, marks = [], onCreate, onCancel, onError }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const number = kind === 'paper' ? 1 : page

  // Read the page's text first: the first page's starting box depends on it, and the editor reads its value once.
  useEffect(() => {
    let cancelled = false
    const task = pdfjs.getDocument({ url: fileUrl, ...PDF_OPTIONS })
    task.promise.then(document => document.getPage(number)).then(async proxy => {
      const base = proxy.getViewport({ scale: 1 })
      const size = { width: base.width, height: base.height }
      const runs = await pageTextRuns(proxy)
      if (!cancelled) setLoaded({ runs, size, start: kind === 'paper' ? firstPageRegion(runs, size) : MIDDLE_REGION })
    }).catch(() => { if (!cancelled) onError(CROP_PAGE_UNAVAILABLE) })
    return () => { cancelled = true; void task.destroy().catch(() => {}) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, number, kind])

  if (!loaded) return <span role="status" style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" aria-hidden="true" /> Loading page…</span>
  return (
    <CropEditor fileUrl={fileUrl} page={number} value={loaded.start} marks={marks} title={REGION_TITLES[kind]} applyLabel="Create post" resetLabel={null}
      onCancel={onCancel}
      onApply={region => { if (region) onCreate({ page: number, region, text: regionText(loaded.runs, region, loaded.size) }) }} />
  )
}
