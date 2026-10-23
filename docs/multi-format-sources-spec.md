# Multi-format sources through EPUB

Status: Draft implementation specification

Target release: pdfpal 3.0

Scope boundary: milestones 1–4 only
Formats in scope: PDF, Markdown, plain text, HTML, EPUB

## 1. Summary

pdfpal will evolve from a PDF-specific reader into a document reader that supports fixed-layout and reflowable sources without converting reflowable documents into fake PDFs or fake pages.

The work stops after these four milestones:

1. Generalize storage, ingestion, extraction, locations, annotations, retrieval, citations, and reader dispatch while preserving all existing PDF behavior.
2. Add local-file and URL ingestion for Markdown and plain text, backed by a shared reflowable reader.
3. Add local HTML and immutable HTML URL snapshots.
4. Add reflowable EPUB 2/3, including its spine, table of contents, progress, search, highlights, and chat citations.

DOCX, notebooks, OCR, presentations, spreadsheets, audio, video, comics, MHTML, DRM, and fixed-layout EPUB are explicitly outside this specification.

The core architectural decision is to replace page-only identity with ordered document units and serializable locators. A unit is a PDF page, an EPUB spine item, an HTML/Markdown section, or a plain-text document. Page numbers remain a first-class PDF feature, but they stop being the universal storage and API abstraction.

## 2. Product goals

### 2.1 Required outcomes

- Existing PDF projects, files, extracted text, search results, reading progress, notes, chats, and highlights survive migration without user action.
- The browser and CLI continue to use the same core services.
- Every supported format can be added from a local file or an HTTP(S) URL.
- Imported sources are stored locally and remain readable if the original URL disappears.
- Search and chat use one retrieval model across all formats.
- Search results and AI context use human-readable locations: `Page 12`, `Chapter 4: Deployment`, or `Section: Limitations`.
- Reading progress and highlights remain stable when a reflowable reader changes width, font size, line spacing, or theme.
- HTML and EPUB content is rendered without executing source scripts.
- Reindexing is format-aware and does not silently destroy user progress or annotations.
- Each milestone is independently testable and leaves the application in a shippable state.

### 2.2 Non-goals

- Pixel-perfect reproduction of publisher EPUB styling.
- A general-purpose web browser or JavaScript-capable webpage archiver.
- DRM circumvention or support for encrypted commercial ebooks.
- Fixed-layout EPUB, media overlays, embedded applications, or interactive EPUB scripts.
- Automatic conversion through Pandoc or Calibre as a required runtime dependency.
- Annotation interchange/export in the first implementation.
- Embedding-based retrieval; SQLite FTS5 remains the retrieval engine.
- Public-server or multi-user hardening. pdfpal remains a local, single-user application, while still treating imported documents as untrusted.

## 3. Current implementation analysis

### 3.1 Runtime architecture

The React SPA calls Fastify. Fastify and the CLI call the same TypeScript services. Runtime state is split between SQLite and managed files under `~/.pdfpal/files`.

The relevant paths are:

- `src/core/sources.ts`: source lifecycle and the current PDF-only orchestrator.
- `src/core/pdf.ts`: PDF URL rewriting, download/discovery, extraction, title inference, excerpts, and file storage.
- `src/core/database.ts`: schema v6, migrations, backup, FTS tables, and legacy-session migration.
- `src/core/retrieval.ts`: page parsing, chunking, indexing, and FTS queries.
- `src/core/chat.ts`: retrieval scope, fallback context, prompt construction, and page citations.
- `src/core/highlights.ts`: project-wide page-sorted highlight listing.
- `src/server/app.ts`: JSON routes, managed PDF serving, annotations, search, and chat.
- `src/cli/index.ts`: direct service-based CLI commands.
- `frontend/src/App.tsx`: the source reader page, PDF progress, selection, and reader/chat composition.
- `frontend/src/components/PdfViewer.tsx`: PDF rendering, page progress, coordinate highlights, and lazy pages.
- `frontend/src/pages/ProjectView.tsx`: source cards, project search, and highlights.
- `frontend/src/components/SearchPaperModal.tsx`: paper search and URL-only browser ingestion.
- `frontend/src/lib/api.ts`: frontend DTOs, all of which currently expose page-oriented source data.

### 3.2 Ingestion assumptions

`SourceService.add` currently:

1. Decides between a local path and URL using an HTTP regex.
2. Resolves every URL as a PDF, including known scholarly URL rewriting and HTML-page PDF discovery.
3. Rejects every local file whose first four bytes are not `%PDF`.
4. Extracts all PDF pages into a single string containing `[Page N]` markers.
5. Stores the original as `<source-id>.pdf`.
6. Inserts one `sources` row and indexes its text.

`SourceService.reindex(..., true)` repeats that same PDF-only pipeline. `pdfPath` and the Fastify file route are also PDF-specific. The browser registers multipart support but has no upload route or local-file UI; local files are currently available only to the CLI.

### 3.3 Schema assumptions

Schema v6 encodes PDF concepts directly:

- `sources.type` is typed as `pdf | url | text`, but every current source is actually stored as `pdf`; input location and content format are conflated.
- `sources.pdf_text` is the canonical extracted text.
- `sources.pages` is used both as page count and extraction-success signal.
- `sources.last_page_read` is the only progress representation.
- `source_chunks.page_number` is non-null and participates in the unique key.
- `annotations` requires a page number and normalized page rectangle.
- Chat result metadata is `{ source, pages[] }`.

The migration framework creates an automatic SQLite backup before changing an older schema. Schema changes are applied on open and recorded in `schema_migrations`. This behavior must remain.

### 3.4 Retrieval and chat assumptions

`extractPdf` serializes pages into one marked-up text field. `splitPages` reconstructs page units, and `RetrievalService.index` creates overlapping 1,500-character chunks with 150-character overlap.

Search returns `page_number`. Chat formats every context block as `page N`, instructs the agent to cite page numbers, and falls back to the first 15,000 characters of `pdf_text` when FTS returns no result. These assumptions must move into unit labels and generic locators without changing FTS ranking or collection/source scoping.

### 3.5 Reader, progress, and annotation assumptions

`App.tsx` always renders `PdfViewer`. It keeps PDF-specific state, debounces `last_page_read` for 750 ms, flushes on `pagehide`, and retries a failed best-effort save. This lifecycle is sound and should be generalized rather than replaced.

PDF highlights use page-relative rectangles. Project highlights and project search display `pN` or `page N`, and clicking them opens the source but does not currently navigate to the exact location. The new model must preserve PDF rectangles while adding text-range selectors and exact navigation.

### 3.6 Storage lifecycle issue to fix while generalizing

Removing an individual source deletes its managed PDF. Deleting a project cascades database rows but does not enumerate and delete managed source files. A format-neutral managed-file service must make source and project deletion clean up originals and derived assets.

### 3.7 Research-only features

Paper search and related-paper discovery remain specialized features. They must not be generalized into arbitrary-document discovery. The `Related` tab should be shown only when the source has a DOI/arXiv/catalogue identity that the research service can resolve; format alone must not decide eligibility.

## 4. Terminology and invariants

- **Source**: one imported original and its current normalized representation.
- **Format**: `pdf`, `markdown`, `text`, `html`, or `epub`.
- **Reader kind**: `fixed` for PDF; `reflowable` for Markdown, text, HTML, and in-scope EPUB.
- **Unit**: an ordered, addressable part of a document.
- **Unit key**: a stable string within one imported source revision, such as `page:12`, `chapter-04.xhtml`, or `section:limitations:1`.
- **Locator**: a serializable reading position inside a source.
- **Selector**: a serializable selected range used by an annotation.
- **Snapshot**: the locally stored original plus normalized representation produced at import or explicit refresh time.
- **Revision**: an incrementing source-content version. Reader settings do not create revisions; refetch/re-extraction does.

Required invariants:

- `(source_id, unit_key)` and `(source_id, unit_index)` are unique.
- Units are zero-based and contiguous by `unit_index`.
- A chunk belongs to exactly one unit and carries offsets into that unit's canonical text.
- Progress always identifies an existing unit in the current revision after validation/reanchoring.
- An annotation can survive a refresh as `orphaned`; it must never be silently deleted because it could not be reanchored.
- Imported content is never trusted merely because it is local.
- Original files are immutable between explicit refetch/reindex operations.

## 5. Canonical domain model

### 5.1 Format and extracted-document types

```ts
export type SourceFormat = 'pdf' | 'markdown' | 'text' | 'html' | 'epub'
export type ReaderKind = 'fixed' | 'reflowable'

export interface ExtractedDocument {
  format: SourceFormat
  readerKind: ReaderKind
  mediaType: string
  canonicalExtension: string
  title: string
  contentText: string
  metadata: DocumentMetadata
  units: ExtractedUnit[]
  assets: ExtractedAsset[]
  warnings: ExtractionWarning[]
}

export interface ExtractedUnit {
  key: string
  index: number
  kind: 'page' | 'chapter' | 'section' | 'document'
  label: string
  title: string | null
  href: string | null
  text: string
  html: string | null
  metadata: Record<string, unknown>
}
```

`contentText` is derived from ordered unit text and exists for excerpts, compatibility, diagnostics, and small fallback operations. Retrieval indexes units, not markers embedded in this string.

### 5.2 Locators

```ts
export type DocumentLocator = PdfLocator | TextLocator

export interface PdfLocator {
  kind: 'pdf'
  unitKey: `page:${number}`
  page: number
}

export interface TextLocator {
  kind: 'text'
  unitKey: string
  progression?: number       // 0..1 inside the unit
  position?: number          // canonical unit-text character offset
  cfi?: string               // optional EPUB CFI
  quote?: TextQuote
}

export interface TextQuote {
  exact: string
  prefix?: string
  suffix?: string
}
```

Raw locator JSON is versioned:

```json
{ "version": 1, "kind": "text", "unitKey": "chapter-04.xhtml", "position": 1832, "progression": 0.31 }
```

### 5.3 Annotation selectors

```ts
export type AnnotationSelector = PdfRectSelector | TextRangeSelector

export interface PdfRectSelector {
  kind: 'pdf-rects'
  locator: PdfLocator
  rects: Array<{ x1: number; y1: number; x2: number; y2: number }>
}

export interface TextRangeSelector {
  kind: 'text-range'
  locator: TextLocator
  start: number
  end: number
  quote: TextQuote
}
```

The text selector deliberately combines text-position and text-quote strategies. Position is fast and exact for an unchanged snapshot; quote plus prefix/suffix is the fallback after re-extraction. This follows the selector concepts in the W3C Web Annotation Data Model without requiring the database representation to be JSON-LD.

### 5.4 Passage and citation types

```ts
export interface Passage {
  source_id: string
  source_title: string
  format: SourceFormat
  unit_key: string
  unit_label: string
  unit_title: string | null
  start_offset: number
  end_offset: number
  content: string
  score: number
}

export interface CitationLocation {
  unit_key: string
  label: string
  start_offset?: number
}
```

`AskResult.sources` becomes `{ id, title, locations: CitationLocation[] }`. A temporary `pages` property may be included for PDF clients during the transition, but new code must not consume it.

## 6. Target database schema

The first foundation milestone introduces schema v7. The migration must run in one SQLite transaction after the existing automatic backup.

### 6.1 Sources

The target `sources` table uses these canonical columns:

```sql
CREATE TABLE sources_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  collection_id TEXT,
  format TEXT NOT NULL CHECK(format IN ('pdf','markdown','text','html','epub')),
  reader_kind TEXT NOT NULL CHECK(reader_kind IN ('fixed','reflowable')),
  url TEXT,
  title TEXT,
  content_text TEXT,
  page_count INTEGER,
  unit_count INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  original_location TEXT,
  local_path TEXT,
  media_type TEXT,
  byte_size INTEGER,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE SET NULL
);
```

`page_count` is non-null only for PDF. A valid image-only PDF can have pages and no searchable text; `has_text` is derived from canonical content rather than inferred from page or unit count. Initial acquisition or extraction failure aborts the import without creating a partial source. A failed refresh leaves the previous revision active.

The old `type`, `pdf_text`, `pages`, and `last_page_read` columns are migrated into the new representation and removed by the table rebuild. API compatibility belongs at the API boundary, not as indefinite duplicate database state.

### 6.2 Document units

```sql
CREATE TABLE source_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  unit_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  title TEXT,
  href TEXT,
  text TEXT NOT NULL DEFAULT '',
  html TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  UNIQUE(source_id, unit_key),
  UNIQUE(source_id, unit_index)
);
CREATE INDEX idx_source_units_order ON source_units(source_id, unit_index);
```

### 6.3 Retrieval chunks

Rebuild `source_chunks` because its current non-null `page_number` and unique constraint cannot represent reflowable units.

```sql
CREATE TABLE source_chunks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY(unit_id) REFERENCES source_units(id) ON DELETE CASCADE,
  UNIQUE(unit_id, chunk_index)
);
```

Recreate the external-content FTS5 table and its insert/delete/update triggers, then issue an FTS rebuild. `RetrievalService.index` takes units and records real character offsets while retaining the current 1,500/150 chunk policy.

### 6.4 Annotations

```sql
CREATE TABLE annotations_new (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  selector_json TEXT NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  status TEXT NOT NULL DEFAULT 'anchored'
    CHECK(status IN ('anchored','orphaned')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_annotations_source ON annotations(source_id, unit_key, created_at);
```

The unit key intentionally has no foreign key. A refresh may temporarily orphan an annotation whose old unit no longer exists; retaining the original selector is required for recovery and user visibility.

### 6.5 Managed assets

```sql
CREATE TABLE source_assets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  local_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  UNIQUE(source_id, asset_key)
);
```

Large binaries remain on disk rather than in SQLite. Rows provide authorization, content type, deduplication metadata, and cleanup inventory.

### 6.6 Existing relational data

- Rebuild `notes` so optional `source_id` has `REFERENCES sources(id) ON DELETE SET NULL`. Deleting a source keeps the user's note as a project note instead of leaving the current dangling source ID.
- Keep chat sessions' existing `ON DELETE SET NULL` behavior and preserve all messages.
- Version `chat_messages.sources_used` JSON. New assistant messages store `{ source_id, title, locations[] }`; legacy string arrays remain readable as source IDs with no saved locations.
- Keep `source_related` keyed to source with cascade deletion. Its use is conditional on resolvable scholarly identity, not on the source format.
- Cross-project source moves continue to update source-linked notes, annotations, and chat sessions in the same transaction, and clear the collection because collections are project-scoped.

## 7. Schema v6 migration

For every existing source:

1. Set `format='pdf'` and `reader_kind='fixed'`.
2. Parse `[Page N]` markers into `source_units`. Create empty page units for pages that have no extracted text so progress and annotations remain addressable.
3. Derive marker-free `content_text` by joining ordered unit text; the marker encoding is not carried into the new canonical field.
4. Set `page_count` to the greatest page established by `pages`, page markers, or annotations, and set `unit_count` from the units actually created.
5. Convert `last_page_read` to a v1 PDF locator and clamp it to the existing unit range.
6. Preserve title, URLs, file metadata, collection, timestamps, and managed `<id>.pdf` path exactly; initialize `warnings_json` to `[]`.
7. Rebuild chunks and their exact offsets deterministically from the migrated units, then rebuild FTS.
8. Convert each annotation to `unit_key='page:N'` and a `pdf-rects` selector. Prefer `rects`; otherwise convert the legacy union rectangle into a one-element array.
9. Convert legacy chat `sources_used` values on read or in place without discarding source IDs; rebuild `notes` with the new nullable source foreign key.
10. Verify all legacy source, annotation, note, related-paper, chat-session, and chat-message rows are accounted for, and verify the expected new unit/chunk counts before committing; then record schema version 7.

For a malformed legacy row with `pages=0`, use page markers and annotation page numbers to recover addressable units. If none exist, retain the source with zero units and null progress rather than inventing a page; its URL/file metadata remains available for an explicit reindex.

Migration tests must cover a real v6-shaped database containing multiple pages, saved progress, old single-box annotations, new multi-rect annotations, chunks, notes, collections, and chat history.

If any step fails, the transaction rolls back and the v6 database remains usable. The pre-migration backup remains the recovery path; no automatic downgrade is required.

## 8. Format-neutral ingestion architecture

Create `src/core/documents/`:

```text
documents/
├── types.ts
├── acquire.ts
├── detect.ts
├── registry.ts
├── storage.ts
├── normalize-html.ts
└── extractors/
    ├── pdf.ts
    ├── markdown.ts
    ├── text.ts
    ├── html.ts
    └── epub.ts
```

### 8.1 Acquisition

```ts
interface AcquiredSource {
  bytes: Buffer
  originalLocation: string
  resolvedUrl: string | null
  declaredMediaType: string | null
  suggestedFilename: string | null
}
```

Acquisition handles local paths and HTTP(S), but does not extract content. It enforces timeouts, redirect limits, size limits, supported protocols, and atomic temporary-file cleanup.

### 8.2 Detection

Detection uses, in order:

1. Explicit `importAs` override.
2. File signatures/container inspection.
3. HTTP `Content-Type`.
4. Filename/URL extension.
5. Conservative content sniffing.

An extension alone never overrides incompatible magic bytes. EPUB detection requires a ZIP container with an EPUB `mimetype` entry; arbitrary ZIP files are rejected.

Generic media types such as `application/octet-stream`, and `text/plain` when bytes are valid text, are not treated as stronger evidence than a recognized `.md`, `.markdown`, `.html`, or `.htm` suffix. This allows common static hosts to serve Markdown/HTML with unspecific headers without misclassifying binary content.

### 8.3 Scholarly PDF compatibility

Known arXiv, OpenReview, ACL Anthology, PMLR, DOI/catalogue, and Google Drive PDF rewrites remain before generic URL fetching.

In automatic mode:

- Known scholarly landing pages retain the current PDF-first behavior.
- Direct PDF, EPUB, Markdown, and text URLs use their detected format.
- Generic HTML is imported as HTML.
- An HTML page with `citation_pdf_url` may retain the current PDF-discovery behavior, but the caller can force HTML with `importAs='html'`.

The browser and CLI expose this override. CLI syntax is `pdfpal source add <project> <location> --as auto|pdf|markdown|text|html|epub`.

### 8.4 Extractor interface

```ts
interface DocumentExtractor {
  readonly format: SourceFormat
  readonly readerKind: ReaderKind
  extract(input: AcquiredSource, context: ExtractionContext): Promise<ExtractedDocument>
}
```

`SourceService` becomes the orchestrator:

1. Resolve project and collection.
2. Acquire bytes.
3. Detect format.
4. Extract into units/assets.
5. Write the complete candidate revision to a temporary source-owned directory.
6. Atomically rename that directory to its final, revision-specific path.
7. In one database transaction, insert the source, units, assets, and chunks and update project access time.
8. If the database transaction fails, remove the unreferenced candidate revision. After a successful refresh transaction, remove the now-unreferenced previous revision.

SQLite and filesystem operations cannot share a real transaction. Revision-specific paths make the safe ordering possible: the database never points at a file that has not already been promoted, and the old revision remains intact until the database commits. A crash can leave an unreferenced revision directory, but cannot make a committed source lose its active files; conservative startup cleanup may remove only verified unreferenced revision directories.

`reindex` dispatches to the stored source format. `--refetch` reacquires the original URL/path; without it, the managed original is the input. User-renamed titles are preserved.

### 8.5 Storage

- New originals and derived assets use `<source-id>/revision-<N>/`; the original is named `original.<canonical-extension>`. Existing flat `<source-id>.pdf` paths remain valid after migration and move into revision storage only on an explicit refresh.
- Asset filenames are opaque, recorded in `source_assets`, and never derived directly from untrusted archive paths or URLs.
- A complete revision directory is written to a sibling temporary path and promoted with an atomic rename.
- `SourceService.remove` removes the original and every asset.
- `ProjectService.delete` inventories source files before the database cascade and removes them after a successful transaction.
- Startup may perform a conservative orphan scan, but it must never delete a file not matching a known pdfpal-managed naming scheme.
- The file endpoint serves the recorded media type, never hard-coded `application/pdf`.

## 9. Reflowable normalization and reader

Markdown, text, HTML, and EPUB converge on sanitized, deterministic unit HTML.

### 9.1 Canonical text mapping

Every text-bearing leaf in normalized HTML receives enough offset metadata for a DOM selection to map back to canonical unit-text offsets. Normalization rules—whitespace collapsing, block separators, line breaks, and Unicode normalization—must be shared by extraction and the browser.

Canonical unit text is normalized before chunking. The chunker must not perform a second lossy whitespace rewrite: for every stored chunk, `unit.text.slice(start_offset, end_offset) === chunk.content`. This makes search results navigable without fuzzy reconstruction.

A text selection produces:

- unit key;
- start/end canonical offsets;
- exact selected text;
- up to 32 characters of prefix and suffix context.

Rendering an annotation first validates offsets and exact text. If they disagree, it searches for the quote and disambiguates with prefix/suffix. Failure marks the annotation orphaned.

### 9.2 `DocumentReader`

Refactor `App.tsx` into a format-neutral source-reader page that renders:

```tsx
<DocumentReader source={source} ... />
```

`DocumentReader` dispatches to:

- `PdfViewerAdapter`, wrapping the existing `PdfViewer` and translating page events/rectangles to generic locators/selectors.
- `ReflowableViewer`, used by Markdown, text, HTML, and EPUB.

Both implement a common contract for progress changes, selected text, highlight creation, annotation navigation, and current-location labels.

### 9.3 Reflowable viewer behavior

- Continuous vertical reading by default.
- Unit/chapter navigation and a table-of-contents drawer when available.
- Font size, line height, content width, and light/dark theme controls.
- Lazy unit loading for long EPUBs.
- Topmost meaningful visible block determines progress.
- Progress stores unit key plus text position/progression; layout-derived page numbers are never persisted.
- Highlight navigation scrolls to and focuses the exact anchored range.
- External links open in a new browser tab with safe `rel` attributes.
- Source scripts, forms, iframes, objects, embeds, event handlers, and unsafe URL schemes are removed.
- Source CSS is not applied in milestones 2–4. pdfpal reader typography is canonical; semantic elements, language, direction, ruby, tables, code, MathML, SVG/images, and footnotes are retained when safe.

This deliberate normalization favors reliable reading, selection, search, and annotations over publisher-perfect layout.

### 9.4 Progress lifecycle

Retain the current 750 ms debounce, `pagehide` flush, keepalive request, and failed-save retry semantics. Replace the numeric pending value with `DocumentLocator` and compare normalized locator equality before sending.

The API validates:

- source and locator kind agree;
- unit key exists;
- PDF page is in range;
- progression is finite and between 0 and 1;
- position is within the current unit text.

## 10. API changes

### 10.1 Source DTOs

List responses omit `content_text` and unit HTML. They include:

```ts
interface SourceSummary {
  id: string
  project_id: string
  collection_id: string | null
  format: SourceFormat
  reader_kind: ReaderKind
  title: string | null
  url: string | null
  media_type: string | null
  page_count: number | null
  unit_count: number
  progress: DocumentLocator | null
  has_text: boolean
  excerpt: string
  created_at: string
  accessed_at: string
}
```

The source-detail response adds metadata, warnings, revision, and a unit manifest, but not all unit text/HTML.

### 10.2 Ingestion routes

- `POST /api/projects/:projectId/sources`
  - JSON: `{ location, title?, collection_id?, import_as?: 'auto' | SourceFormat }`
- `POST /api/projects/:projectId/sources/upload`
  - multipart file plus optional title, collection, and import-as fields
- `POST /api/extract`
  - retained as a deprecated compatibility wrapper through the 3.0 cycle

Browser uploads use the same acquisition/extraction transaction as CLI local paths.
The old `{ url, title?, collection_id? }` add-source body remains accepted as an alias for `{ location, ... }` through the 3.0 cycle. The PDF-only `/api/proxy-pdf` route remains only for legacy clients/sources during that window; new reader code always requests the authorized managed source file.

### 10.3 Content routes

- `GET /api/projects/:projectId/sources/:sourceId/file`: managed original with dynamic media type and range support where practical.
- `GET /api/projects/:projectId/sources/:sourceId/units`: ordered manifest without full content.
- `GET /api/projects/:projectId/sources/:sourceId/units/:unitId`: normalized unit HTML/text.
- `GET /api/projects/:projectId/sources/:sourceId/assets/:assetId`: a validated managed asset.

Unit and asset IDs are opaque database IDs in routes; clients do not put EPUB hrefs into URL paths.

### 10.4 Progress and annotations

- `PATCH /api/projects/:projectId/sources/:sourceId` accepts `{ progress: DocumentLocator }`.
- A temporary `{ last_page_read: N }` compatibility input converts to a PDF locator.
- Annotation create accepts `{ selector, text, color }`.
- Annotation list returns selector, status, unit label, and navigation locator.
- Annotation endpoints resolve and validate the source/project before inserting or updating; direct unvalidated SQL in route handlers is removed.

### 10.5 Search and chat

- Project search returns generic passage location fields.
- Search-card navigation includes a unit and offset.
- Highlight navigation uses `?annotation=<id>` so the reader can resolve current anchoring server-side.
- Chat context headers use each unit's label/title.
- Prompt language changes from “cite page numbers” to “cite the supplied source and location labels.”
- Fallback context is built from initial units and obeys the existing 80,000-character prompt cap.

## 11. CLI and agent skill

Existing commands remain, with format-neutral language:

- `source add` accepts every in-scope local file or URL and gains `--as`.
- `source show/list` expose format, media type, page count when relevant, and unit count.
- `source reindex --refetch` works for all formats.
- `search` emits unit keys/labels and offsets instead of requiring a page number.
- `highlights` emits generic locations.
- `ask` returns generic citation locations.

Human CLI output prints `370 pages`, `18 chapters`, `7 sections`, or `1 document` as appropriate. JSON fields are stable and documented. `skills/pdfpal-cli/SKILL.md`, README examples, help strings, and package description must stop claiming the tool is PDF-only when milestone 4 ships.

## 12. Format specifications

### 12.1 PDF

The PDF extractor is moved behind the common interface with no intentional behavior loss:

- Existing URL rewrites and PDF discovery remain.
- Metadata/title inference remains.
- Units are pages labeled `Page N` with keys `page:N`.
- Rendering remains `react-pdf`/PDF.js with current lazy rendering and real page geometry.
- Progress remains page-based.
- Highlights remain normalized page rectangles.
- Page citations and related-paper behavior remain.

Milestone 1 is not complete until the full existing PDF test suite passes against the new model.

### 12.2 Markdown

- Extensions: `.md`, `.markdown`.
- Media types: `text/markdown` plus conservative extension fallback.
- Inputs: local upload/path and direct HTTP(S) URL.
- UTF-8 with optional BOM in the first implementation.
- YAML front matter may supply title, author, language, and date; it is removed from rendered body text.
- Rendering supports the existing GFM and math behavior used by notes/chat.
- Units split at level-one or level-two headings; preamble becomes the first section. A heading-free document is one unit.
- Generated unit keys use normalized heading slug plus occurrence index and remain deterministic for the same content.
- Raw HTML inside Markdown goes through the same sanitizer and is not trusted.

### 12.3 Plain text

- Extensions: `.txt`, `.text`.
- Media type: `text/plain`.
- Inputs: local upload/path and direct HTTP(S) URL.
- UTF-8 with optional BOM in the first implementation.
- One document unit unless the source contains form-feed separators, which create labeled sections.
- Reader preserves paragraph and intentional line-break structure without using a single unwrapped `<pre>` for an entire book.
- Title comes from an explicit title, metadata/filename, or first non-empty short line.

### 12.4 HTML

#### Local HTML

- Extensions: `.html`, `.htm`.
- The original file is stored unchanged.
- The body is sanitized and normalized into reader HTML.
- `<title>`, Open Graph, standard meta tags, and JSON-LD provide metadata when valid.
- Data-URL images within limits may be extracted into managed assets.
- Relative sibling filesystem assets are not imported in milestone 3. Missing local assets generate visible import warnings rather than reading arbitrary adjacent files.

#### HTML URLs

- The imported document is an immutable snapshot, never a live iframe of the source website.
- Fetch static/server-rendered HTML only; do not launch a headless browser or execute JavaScript.
- Use Mozilla Readability for article extraction when readerable.
- If Readability fails, sanitize and normalize a conservative `<main>`/`article`/`body` fallback, or fail with a clear extraction error if meaningful text is absent.
- Resolve links against the final response URL.
- Download eligible images into managed assets within per-asset and total limits; do not retain tracking pixels.
- Do not download or execute scripts, stylesheets, fonts, frames, media players, or forms.
- Store final URL, canonical URL when present, import time, original response bytes, normalized content, and extraction warnings.
- Refresh occurs only through explicit refetch/reindex.

Sections split at meaningful headings. Section labels use heading text, with `Article` as the fallback.

### 12.5 EPUB

- Support EPUB 2 and EPUB 3 reflowable publications.
- Inputs: local `.epub` and direct HTTP(S) EPUB URLs.
- Validate the ZIP container, `mimetype`, `META-INF/container.xml`, package document, manifest, and spine.
- Read EPUB 3 navigation documents and EPUB 2 NCX tables of contents.
- One unit per linear spine item; unit key is its normalized package-relative href without fragment.
- Unit titles come from navigation entries, then the first heading, then `Chapter N`.
- Normalize each XHTML spine item through the shared HTML sanitizer and canonical text mapper.
- Import safe referenced images/SVG as managed assets. Do not execute scripts or preserve active content.
- Preserve language, direction, semantic headings, lists, tables, code, MathML, ruby, footnote links, and safe internal links.
- Store spine href and optional CFI data in unit metadata. Initial progress/highlights require spine href plus canonical text position/quote; CFI is optional but should be retained when the selected EPUB parser provides it reliably.
- Font/theme/layout changes must not alter saved progress or highlight anchoring.
- Detect fixed-layout rendition metadata and fail with `EPUB_FIXED_LAYOUT_UNSUPPORTED`.
- Detect encrypted/DRM-protected content and fail with `EPUB_ENCRYPTED`. Font obfuscation may be ignored because publisher CSS/fonts are not required.
- Reject path traversal, absolute archive paths, excessive entry count, excessive compression ratio, or excessive total uncompressed bytes.

The initial implementation should normalize EPUB into pdfpal's shared reflowable reader rather than embedding a full third-party reading system. This keeps selection, highlights, search, and progress identical across HTML and EPUB. A full-fidelity Readium/EPUB.js renderer can be evaluated later behind the same `DocumentReader` contract.

## 13. Security and resource limits

Imported HTML, Markdown HTML, and EPUB XHTML are untrusted.

Required controls:

- HTTP(S) only for remote acquisition.
- Preserve the current timeout behavior under format-neutral error codes.
- Enforce configurable original-file limits; initial defaults should be at least the current 25–30 MB browser limits and large enough for common books.
- Separate lower limits for HTML, text, and each downloaded asset.
- Limit redirect count, EPUB entry count, total uncompressed archive size, and compression ratio.
- Canonicalize archive paths and prevent ZIP Slip.
- Disable scripts and external file access in every parser/converter.
- Sanitize allowed tags and attributes server-side before persistence and again defensively at the rendering boundary.
- Reject `javascript:`, executable `data:` URLs, inline event handlers, forms, frames, objects, embeds, and active SVG.
- Serve assets with recorded content type, `nosniff`, restrictive CSP, and safe content disposition.
- Do not allow local HTML to traverse from its path into sibling files.
- Keep source URL credentials out of logs and stored display strings where possible.

Suggested generic error codes:

- `UNSUPPORTED_FORMAT`
- `FORMAT_MISMATCH`
- `SOURCE_FETCH_TIMEOUT`
- `SOURCE_FETCH_FAILED`
- `SOURCE_TOO_LARGE`
- `INVALID_TEXT_ENCODING`
- `HTML_EXTRACTION_FAILED`
- `INVALID_EPUB`
- `EPUB_ENCRYPTED`
- `EPUB_FIXED_LAYOUT_UNSUPPORTED`
- `ARCHIVE_LIMIT_EXCEEDED`
- `INVALID_LOCATOR`

Existing PDF error codes may be mapped to the new generic codes in API responses while retaining compatibility details for one release.

## 14. Refresh, reindex, and reanchoring

Reindex creates a candidate extraction before replacing current units.

Within one transaction:

1. Increment source revision.
2. Replace units and chunks.
3. Reanchor progress by exact unit key and position, then quote, then nearest surviving unit/progression.
4. Reanchor text annotations by unit key/position, then quote/context across candidate units.
5. Clamp PDF progress and retain PDF selectors by page when pages survive.
6. Mark unresolved annotations `orphaned` and preserve their original selector/text.
7. Point the source and asset rows at the already-promoted candidate revision and update content, metadata, hash, and revision.

If extraction, candidate promotion, or the database transaction fails, current content, progress, annotations, index, and managed original remain unchanged. The failed candidate is removed when possible and is otherwise eligible for conservative orphan cleanup. After commit, the previous revision is removed. An explicit UI warning lists extraction warnings and orphaned highlights after a successful refresh.

## 15. Frontend product changes

### 15.1 Add-source experience

Rename `SearchPaperModal` to `AddSourceModal` with three tabs:

1. Search papers.
2. Paste URL.
3. Local file.

URL and file tabs display supported formats and an `Auto-detect` format selector with explicit overrides. Paper-search results remain PDF-oriented.

### 15.2 Source lists

- Format-specific icon/badge.
- `N pages` only for PDF.
- Chapter/section count for structured reflowable content.
- Import failures stay in the add-source workflow as actionable errors and do not create broken source cards; a failed refresh leaves the existing card and revision usable.
- Excerpts derived from generic `content_text`.

### 15.3 Reader page

- Rename PDF-specific state and copy (`pdfText`, `pdfPages`, “Load a PDF”) to source/document terminology.
- Preserve split-pane resizing, chat, notes, deletion, and user controls.
- Show `Related` only when research identity is available.
- Show format-appropriate location and total in the header.
- Exact search/highlight deep links restore the requested unit/range before ordinary saved progress.

## 16. Test strategy

### 16.1 Fixtures

Add small deterministic fixtures:

- existing two-page PDF;
- Markdown with front matter, headings, GFM, math, and raw unsafe HTML;
- UTF-8 plain text with paragraphs and form feed;
- local HTML with metadata, headings, links, data image, and malicious elements;
- URL article responses for successful Readability, fallback extraction, redirects, oversized content, and failure;
- minimal EPUB 2 and EPUB 3 books with multiple spine items, TOC, image, footnote, RTL metadata, and unsafe script;
- invalid ZIP, ZIP Slip path, zip bomb metadata, fixed-layout EPUB, and encrypted EPUB.

### 16.2 Unit tests

- Format detection and explicit override precedence.
- URL rewrite compatibility.
- Each extractor's metadata, units, labels, canonical text, and sanitized HTML.
- Deterministic unit keys and text offsets.
- Chunk offsets and overlap.
- Locator validation and serialization.
- Quote reanchoring, ambiguous quotes, and orphan behavior.
- Archive/resource limits.
- Managed storage atomicity and cleanup.

### 16.3 Integration tests

- Add, store, index, show, list, move, file, reindex, refetch, and remove each format through `SourceService` and CLI.
- Browser upload and URL ingestion through Fastify.
- Dynamic file/asset content types.
- Project deletion removes all managed originals/assets.
- Search returns correct generic locations.
- Chat prompt and result citations use unit labels.
- Schema v6 migration preserves all existing PDF state and FTS results.
- Failed extraction/refetch leaves the previous revision intact.

### 16.4 Frontend E2E tests

- Existing PDF reader, progress, highlight, and page-geometry tests remain green.
- Upload and read Markdown/text; change typography and restore progress.
- Import static HTML; verify scripts cannot run and content remains after the test origin disappears.
- Import EPUB; navigate TOC, reload into the saved chapter/offset, search, highlight, and ask from selected text.
- Search/highlight cards deep-link to exact positions for fixed and reflowable sources.
- Unsupported/failing sources show format-specific actionable errors.

### 16.5 Required checks per milestone

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
npm pack --dry-run
```

No milestone may weaken coverage thresholds or delete an existing PDF regression test merely because its DTO changed.

## 17. Delivery plan and acceptance gates

### Milestone 1 — generalized foundation

Deliver:

- schema v7 and tested v6 migration;
- format-neutral domain types, source DTOs, managed storage, extractor registry, units, chunks, locators, annotations, and citations;
- PDF extractor adapter and PDF reader adapter;
- generic API/CLI contracts and deprecated compatibility inputs;
- exact search/highlight deep links;
- project file cleanup.

Acceptance gate: all existing PDF behaviors and data survive; no non-PDF format needs to be user-visible yet.

### Milestone 2 — Markdown and text

Deliver:

- Markdown/text detection and extractors;
- browser local-file upload;
- shared reflowable viewer and typography controls;
- generic selection, highlight, progress, search, chat, and citations;
- local and URL flows in UI and CLI.

Acceptance gate: layout changes do not move saved anchors, and local/URL sources remain readable from managed copies.

### Milestone 3 — HTML snapshots

Deliver:

- local HTML extraction;
- static URL fetching, Readability, fallback extraction, sanitization, metadata, and managed eligible images;
- immutable snapshot semantics and explicit refresh;
- security and failure-state tests.

Acceptance gate: imported URL content remains unchanged/readable offline, and malicious test content cannot execute or escape its managed source.

### Milestone 4 — EPUB

Deliver:

- safe EPUB container parsing;
- EPUB 2/3 package, spine, metadata, TOC, XHTML, image, link, and footnote handling;
- chapter navigation, progress, highlights, search, and chat citations in the shared reader;
- explicit errors for DRM, invalid containers, and fixed-layout EPUB.

Acceptance gate: a multi-chapter reflowable EPUB can be imported from file and URL, read, searched, highlighted, queried, closed, and reopened at the stable saved location.

Work stops here for review before any DOCX, notebook, OCR, presentation, or additional-format planning becomes implementation scope.

## 18. Dependencies and standards

Candidate dependencies must be pinned and evaluated before implementation:

- Mozilla Readability plus a non-script-executing DOM implementation for HTML article extraction.
- A maintained server-side HTML sanitizer.
- A ZIP implementation with controlled entry iteration and uncompressed-size accounting.
- An XML parser configured without external entity resolution for EPUB package documents.

Existing React Markdown/GFM/math dependencies should be reused for Markdown semantics where they can share the canonical normalization pipeline.

References:

- EPUB 3.3: <https://www.w3.org/TR/epub-33/>
- W3C Web Annotation Data Model: <https://www.w3.org/TR/annotation-model/>
- Mozilla Readability: <https://github.com/mozilla/readability>
- CommonMark: <https://commonmark.org/>
- Readium Web, for a possible future full-fidelity renderer: <https://readium.org/web/>
- EPUB.js, for a possible future full-fidelity renderer: <https://github.com/futurepress/epub.js/>

## 19. Definition of done

The multi-format initiative described here is done when milestones 1–4 pass their acceptance gates, all published help and agent-skill language matches the supported formats, existing PDF data is demonstrably preserved by migration tests, and no code path requires a fake page number for a reflowable document.
