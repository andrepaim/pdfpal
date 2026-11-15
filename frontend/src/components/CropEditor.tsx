// The crop editor: a modal that shows the whole PDF page with the reader's highlights and the share post's crop as a
// box, dimming what the crop leaves out. Drag the box to move it and its eight handles to resize it, or use the arrow
// keys on the focused part (Shift for larger steps). The geometry is in lib/share-card/crop-edit.ts; this file only
// turns pointer and key events into it. See "Crop editor (T3)" in docs/share-posts-plan.md.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from 'react'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { PageMark, PageRect } from '../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../lib/pdf-document'
import { HIGHLIGHT_HEX } from '../lib/share-card/looks'
import { CROP_HANDLES, cropAttribute, cropDescription, dragCrop, normalizeCrop, nudgeCrop, type CropHandle, type CropPart } from '../lib/share-card/crop-edit'

type Props = {
  fileUrl: string; page: number
  /** The crop to start from, as page fractions. Read when the editor opens. */ value: PageRect
  marks: PageMark[]
  /** null means "back to automatic". */ onApply: (crop: PageRect | null) => void
  onCancel: () => void
}

export const CROP_PAGE_UNAVAILABLE = 'The PDF page could not be loaded.'

const HANDLE_NAMES: Record<CropHandle, string> = {
  n: 'Top edge', s: 'Bottom edge', e: 'Right edge', w: 'Left edge',
  nw: 'Top left corner', ne: 'Top right corner', se: 'Bottom right corner', sw: 'Bottom left corner',
}
const CURSORS: Record<CropHandle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
/** Room around the page so handles on its edges are not cut off, in CSS pixels. */
const GUTTER = 16
/** The dialog's largest height, and the space it leaves around itself in the window, in CSS pixels. */
const MAX_DIALOG_HEIGHT = 1040
const WINDOW_MARGIN = 16
/** The largest side of the rendered page, in device pixels. */
const MAX_PAGE_PX = 4096

const button: CSSProperties = { background: 'none', border: '1px solid var(--border)', color: '#d1d5db', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
const primary: CSSProperties = { ...button, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', fontWeight: 600 }
const hidden: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
const pct = (value: number) => `${value * 100}%`

type Drag = { part: CropPart; start: PageRect; x: number; y: number; pointer: number; width: number; height: number }
type LoadedPage = { proxy: PDFPageProxy; width: number; height: number }

export default function CropEditor({ fileUrl, page, value, marks, onApply, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | null>(null)
  /** Set once the editor has called onApply or onCancel, so a browser-initiated close does not report twice. */
  const done = useRef(false)
  const focusedBox = useRef(false)

  const [rect, setRect] = useState<PageRect>(() => normalizeCrop(value))
  const rectRef = useRef(rect)
  rectRef.current = rect
  const [pdfPage, setPdfPage] = useState<LoadedPage | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [space, setSpace] = useState<{ width: number; height: number } | null>(null)
  const [dragging, setDragging] = useState<CropPart | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Open as a modal before the first paint; give focus back to whatever had it when the editor goes away.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    cancelRef.current?.focus({ preventScroll: true })
    return () => {
      if (dialog?.open) dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  // Load the page.
  useEffect(() => {
    let cancelled = false
    setStatus('loading'); setPdfPage(null)
    const task = pdfjs.getDocument({ url: fileUrl, ...PDF_OPTIONS })
    task.promise.then(document => document.getPage(page)).then(proxy => {
      if (cancelled) return
      const base = proxy.getViewport({ scale: 1 })
      setPdfPage({ proxy, width: base.width, height: base.height })
    }).catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true; void task.destroy().catch(() => {}) }
  }, [fileUrl, page])

  // Measure the room the page may fill: the stage's width, and the window's height less the rest of the dialog. The
  // dialog then takes the page's height, so a narrow window does not show empty bands above and below the page.
  useEffect(() => {
    const dialog = dialogRef.current, stage = stageRef.current
    if (!dialog || !stage) return
    const measure = () => {
      const chrome = dialog.offsetHeight - stage.offsetHeight
      const width = Math.max(0, stage.clientWidth - 2 * GUTTER)
      const height = Math.max(0, Math.min(MAX_DIALOG_HEIGHT, window.innerHeight - WINDOW_MARGIN) - chrome - 2 * GUTTER)
      setSpace(previous => previous && previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const frame = pdfPage && space && space.width > 0 && space.height > 0 ? (() => {
    const scale = Math.min(space.width / pdfPage.width, space.height / pdfPage.height)
    return { width: Math.max(1, Math.floor(pdfPage.width * scale)), height: Math.max(1, Math.floor(pdfPage.height * scale)) }
  })() : null

  // Render the page at the frame's size in device pixels, into a spare canvas first so a resize never flashes blank.
  const rendered = useRef(false)
  useEffect(() => {
    if (!pdfPage || !frame) return
    let task: RenderTask | null = null
    let cancelled = false
    const timer = window.setTimeout(() => {
      const density = Math.min(window.devicePixelRatio || 1, 3)
      const scale = Math.min(frame.width * density / pdfPage.width, MAX_PAGE_PX / Math.max(pdfPage.width, pdfPage.height))
      const viewport = pdfPage.proxy.getViewport({ scale })
      const spare = document.createElement('canvas')
      spare.width = Math.max(1, Math.round(viewport.width)); spare.height = Math.max(1, Math.round(viewport.height))
      const context = spare.getContext('2d')
      if (!context) { setStatus('error'); return }
      task = pdfPage.proxy.render({ canvas: null, canvasContext: context, viewport, background: 'rgb(255,255,255)' })
      task.promise.then(() => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        canvas.width = spare.width; canvas.height = spare.height
        canvas.getContext('2d')?.drawImage(spare, 0, 0)
        spare.width = 0
        rendered.current = true
        setStatus('ready')
      }).catch((error: unknown) => {
        if (!cancelled && (error as { name?: string } | null)?.name !== 'RenderingCancelledException') setStatus('error')
      })
    }, rendered.current ? 120 : 0)
    return () => { cancelled = true; window.clearTimeout(timer); task?.cancel() }
  }, [pdfPage, frame?.width, frame?.height])

  // Put focus on the crop box once there is something to adjust.
  useEffect(() => {
    if (status !== 'ready' || focusedBox.current) return
    focusedBox.current = true
    boxRef.current?.focus({ preventScroll: true })
  }, [status])

  const finish = (crop: PageRect | null | 'cancel') => {
    if (done.current) return
    done.current = true
    if (crop === 'cancel') onCancel(); else onApply(crop)
  }

  const startDrag = (part: CropPart) => (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    const box = frameRef.current?.getBoundingClientRect()
    if (!box?.width || !box.height) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* A synthetic pointer cannot be captured; the drag still works inside the element. */ }
    event.currentTarget.focus({ preventScroll: true })
    drag.current = { part, start: rect, x: event.clientX, y: event.clientY, pointer: event.pointerId, width: box.width, height: box.height }
    setDragging(part)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    setRect(dragCrop(current.start, current.part, (event.clientX - current.x) / current.width, (event.clientY - current.y) / current.height))
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    setDragging(null)
    // A pointer that lifts lands the box where it lifted; a cancelled one (whose coordinates may be meaningless) leaves
    // the box where the last move put it.
    const final = event.type === 'pointerup'
      ? dragCrop(current.start, current.part, (event.clientX - current.x) / current.width, (event.clientY - current.y) / current.height)
      : rectRef.current
    setRect(final)
    setAnnouncement(cropDescription(final))
  }
  const onKey = (part: CropPart) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const next = nudgeCrop(rect, part, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    setRect(next)
    setAnnouncement(cropDescription(next))
  }
  const pointerProps = (part: CropPart) => ({
    onPointerDown: startDrag(part), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag,
  })

  const onDialogCancel = (event: SyntheticEvent<HTMLDialogElement>) => { event.preventDefault(); finish('cancel') }
  // A close the editor did not ask for, such as a browser that closes the dialog on a repeated Escape. The dialog is
  // open again by then when React's development double mount closed and reopened it, and that close is ignored.
  const onDialogClose = () => { if (!dialogRef.current?.open) finish('cancel') }

  const description = cropDescription(rect)
  const ready = status === 'ready'
  return (
    <dialog ref={dialogRef} aria-labelledby="crop-editor-title" aria-describedby="crop-editor-hint" onCancel={onDialogCancel} onClose={onDialogClose}
      className="share-dialog crop-editor" data-crop-editor data-state={status}
      style={{
        margin: 'auto', background: 'var(--panel)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 12,
        padding: 'clamp(10px, 3vw, 20px)', boxSizing: 'border-box', overflow: 'hidden',
        width: `min(760px, calc(100vw - ${WINDOW_MARGIN}px))`, maxWidth: `calc(100vw - ${WINDOW_MARGIN}px)`,
        maxHeight: `min(${MAX_DIALOG_HEIGHT}px, calc(100dvh - ${WINDOW_MARGIN}px))`,
      }}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '100%', minHeight: 0 }}>
        <h2 id="crop-editor-title" style={{ fontSize: 15, margin: '0 0 4px' }}>Adjust crop</h2>
        <p id="crop-editor-hint" style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 4px' }}>
          {status === 'error' ? CROP_PAGE_UNAVAILABLE : 'Drag the box to move it, or its handles to resize it. Arrow keys move the focused part; hold Shift for larger steps.'}
        </p>
        <div ref={stageRef} style={{ flex: '0 1 auto', minHeight: 0, boxSizing: 'border-box', height: frame ? frame.height + 2 * GUTTER : status === 'error' ? 'auto' : 320, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: GUTTER }}>
          {status === 'error' ? (
            <p role="alert" style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{CROP_PAGE_UNAVAILABLE}</p>
          ) : <>
            {!ready && (
              <div role="status" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 12, color: '#9ca3af' }}>
                <span className="spinner" aria-hidden="true" /> Loading page…
              </div>
            )}
            {frame && (
              <div ref={frameRef} data-crop-page style={{ position: 'relative', width: frame.width, height: frame.height, flex: 'none', visibility: ready ? 'visible' : 'hidden', boxShadow: '0 4px 18px rgba(0,0,0,0.45)' }}>
                <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%', background: '#fff' }} />
                <svg aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {marks.flatMap((mark, index) => mark.rects.map((r, part) => (
                    <rect key={`${index}-${part}`} data-crop-mark={mark.color} x={r.x1} y={r.y1} width={Math.max(0, r.x2 - r.x1)} height={Math.max(0, r.y2 - r.y1)}
                      fill={HIGHLIGHT_HEX[mark.color] ?? HIGHLIGHT_HEX.yellow} fillOpacity={0.45} style={{ mixBlendMode: 'multiply' }} />
                  )))}
                  <path fill="rgba(0,0,0,0.55)" fillRule="evenodd" d={`M0 0H1V1H0Z M${rect.x1} ${rect.y1}V${rect.y2}H${rect.x2}V${rect.y1}Z`} />
                </svg>
                <div ref={boxRef} role="group" tabIndex={0} data-crop-box data-crop={cropAttribute(rect)}
                  aria-roledescription="crop area" aria-label={`Crop: ${description}`} aria-describedby="crop-editor-hint"
                  onKeyDown={onKey('box')} {...pointerProps('box')}
                  style={{
                    position: 'absolute', left: pct(rect.x1), top: pct(rect.y1), width: pct(rect.x2 - rect.x1), height: pct(rect.y2 - rect.y1),
                    boxSizing: 'border-box', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.35)',
                    cursor: dragging === 'box' ? 'grabbing' : 'move', touchAction: 'none',
                  }} />
                {CROP_HANDLES.map(handle => {
                  const fx = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5
                  const fy = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5
                  const corner = handle.length === 2, across = handle === 'n' || handle === 's'
                  const active = dragging === handle
                  return (
                    <div key={handle} role="button" tabIndex={0} data-crop-handle={handle} aria-label={HANDLE_NAMES[handle]} aria-describedby="crop-editor-hint"
                      onKeyDown={onKey(handle)} {...pointerProps(handle)}
                      style={{
                        position: 'absolute', left: pct(rect.x1 + fx * (rect.x2 - rect.x1)), top: pct(rect.y1 + fy * (rect.y2 - rect.y1)),
                        width: 32, height: 32, transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: CURSORS[handle], touchAction: 'none', zIndex: corner ? 2 : 1,
                      }}>
                      <span aria-hidden="true" style={{
                        display: 'block', boxSizing: 'border-box', background: active ? '#c7d2fe' : '#fff', border: '1px solid rgba(0,0,0,0.75)',
                        borderRadius: corner ? 3 : 4, boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
                        width: corner ? 14 : across ? 26 : 8, height: corner ? 14 : across ? 8 : 26,
                      }} />
                    </div>
                  )
                })}
              </div>
            )}
          </>}
        </div>
        <div aria-live="polite" style={hidden}>{announcement}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
          {status !== 'error' && <button type="button" onClick={() => finish(null)} style={{ ...button, marginRight: 'auto' }}>Reset to automatic</button>}
          <button ref={cancelRef} type="button" onClick={() => finish('cancel')} style={{ ...button, marginLeft: status === 'error' ? 'auto' : undefined }}>Cancel</button>
          {status !== 'error' && <button type="button" onClick={() => finish(rect)} disabled={!ready} style={{ ...primary, opacity: ready ? 1 : 0.5 }}>Apply</button>}
        </div>
      </div>
    </dialog>
  )
}
