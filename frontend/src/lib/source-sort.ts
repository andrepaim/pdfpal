import type { Source } from './api'

export const sourceSortLabels = {
  newest: 'Newest added',
  oldest: 'Oldest added',
  titleAsc: 'Title A–Z',
  titleDesc: 'Title Z–A',
}

export type SourceSort = keyof typeof sourceSortLabels

export function sourceSortOrDefault(value: unknown): SourceSort {
  return typeof value === 'string' && Object.hasOwn(sourceSortLabels, value) ? value as SourceSort : 'newest'
}

export function sourceDisplayTitle(source: Source): string {
  return source.title || source.url || 'Untitled'
}

const titleOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function newestFirst(a: Source, b: Source): number {
  return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
}

export function sortSources(sources: Source[], sort: SourceSort): Source[] {
  return sources.slice().sort((a, b) => {
    switch (sort) {
      case 'newest': return newestFirst(a, b)
      case 'oldest': return newestFirst(b, a)
      case 'titleAsc': return titleOrder.compare(sourceDisplayTitle(a), sourceDisplayTitle(b)) || newestFirst(a, b)
      case 'titleDesc': return titleOrder.compare(sourceDisplayTitle(b), sourceDisplayTitle(a)) || newestFirst(a, b)
    }
  })
}
