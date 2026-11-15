// /dev/share-cards: the share-card sample matrix, for review and the browser test (frontend/e2e/share-cards.spec.ts).
// Hidden: loaded lazily and linked from nowhere. Every card is drawn, encoded as a PNG and shown as an image, so
// the page holds a hundred-odd small blobs instead of as many full-size canvases.
import { useEffect, useState } from 'react'
import { LOOKS, type CardSize, type ShareLook, type ShareStyle } from '../../../src/shared/share-card'
import { canvasPng, renderCard } from '../lib/share-card'
import { SAMPLES } from '../lib/share-card/samples'

type Result = { name: string; url?: string; error?: string }
const STYLES: ShareStyle[] = ['quote', 'idea', 'takeaways']
const SIZES: CardSize[] = ['feed', 'story']

export default function ShareCardSamples() {
  const [results, setResults] = useState<Result[]>([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    void (async () => {
      for (const sample of SAMPLES) for (const style of STYLES) for (const look of LOOKS as readonly ShareLook[]) for (const size of SIZES) {
        if (cancelled) return
        const name = `${sample.name}-${style}-${look}-${size}`
        let result: Result
        try {
          const canvas = await renderCard({ card: sample.card, source: sample.source }, { style, look, size })
          const url = URL.createObjectURL(await canvasPng(canvas))
          canvas.width = 0
          urls.push(url)
          result = { name, url }
        } catch (error) { result = { name, error: error instanceof Error ? error.message : String(error) } }
        if (!cancelled) setResults(previous => [...previous, result])
      }
      if (!cancelled) setDone(true)
    })()
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [])
  return (
    <main style={{ padding: 24, background: '#202024', minHeight: '100vh', color: '#eee', fontFamily: 'system-ui, sans-serif' }} data-samples-done={done ? 'true' : undefined}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Share card samples ({results.length}{done ? '' : '…'})</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {results.map(result => (
          <figure key={result.name} data-sample={result.name} data-fits={result.url ? 'true' : 'false'} style={{ margin: 0, width: 216 }}>
            {result.url ? <img src={result.url} alt={result.name} style={{ width: 216, display: 'block', borderRadius: 4 }} />
              : <div role="alert" style={{ width: 216, height: 270, background: '#511', padding: 8 }}>{result.error}</div>}
            <figcaption style={{ fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>{result.name}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  )
}
