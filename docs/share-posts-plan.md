# Share posts: the paper's own pixels, with the reader's take

Plan dated 15 November 2026. It follows `docs/share-cards-plan.md` (the first build, kept as the record of what exists) and changes its direction. Branch `feat/share-posts`, worktree `../pdfpal-share-posts`, based on `feat/share-cards` merged with `origin/master` at 0ad0f70.

## Why the direction changed

The owner asked whether the first build automates what people do by hand when they share something from a paper. A study of about 200 real posts (kept outside the repository, in the owner's `pdfpal-share-cards-study` folder) answered it:

- No individual was seen posting a typeset quote from a paper (0 of 70 posts with an image). The first build's default card is that format.
- On LinkedIn and X people post the paper's own pixels: the title, authors and abstract with their highlights on it, or a figure.
- On Instagram nobody posts a bare page. The closest hand-made posts put a headline in the sharer's words above the page.
- The text is the reader's position, not a summary. LinkedIn texts run 150 to 300 words, Instagram captions 100 to 200, X posts under 280 characters.
- Whole-paper posts are carousels: hook, the study and its size, one finding per slide, takeaway, source on the slide.

## Owner decisions (15 November 2026)

1. The image is always a framed crop of the PDF with the reader's highlights. Quote, Big idea and Takeaways become secondary "text cards".
2. The reader picks a destination first (LinkedIn, X, Instagram). It sets the frame, the text length and the defaults. One request writes for one destination.
3. The draggable crop is part of stage 1.
4. All of this happens before share cards merge to `master`. Schema version 16 has not shipped, so its table may still change.

The decisions in `docs/share-cards-plan.md` that still hold: the assistant never alters a quote, the reader may; looks Ink, Paper and Marker; the small `PDFPAL` wordmark; PDF sources only; posts stay on the device and are never synced.

## Intended behaviour

A post is **an evidence image plus a draft built around the reader's take**.

### The image

- A crop of the PDF page, drawn with **every highlight the reader has inside the crop**, each in its own colour.
- The crop starts automatic (the highlight plus lines of context) and the reader can **drag its edges or move it** in a crop editor, or reset it to automatic.
- Three ways to start a post: from a highlight (stage 1), from a box drawn on a page, and from the first page (stage 2).
- Frames by destination:

| Destination | Default style | Size | Automatic context | Hashtags shown |
| --- | --- | --- | --- | --- |
| LinkedIn | Page | Fit: 1080 wide, as tall as the crop needs, 608 to 1350 | 3 lines | No |
| X, Bluesky, Threads | Page | Fit | 1 line | No |
| Instagram | Headline (a headline above the crop) | Feed 1080 × 1350; Story 1080 × 1920 on export | 3 lines | Yes |

- Every frame keeps the credit strip (title, credit, page) and the wordmark.
- When the PDF file is gone, Page falls back to Quote and Headline to Big idea, as Page does today.

### The text

- One request returns **up to three drafts**, one per angle, written for the chosen destination. The reader picks one.
  - **The finding**: what the text states, with its number and the study's design or size first when the text gives them. Always present.
  - **Belief versus paper**: the common assumption, then what the paper found. Only when the supplied text itself states or clearly implies that assumption; otherwise empty.
  - **The caveat**: the limit or qualification that should travel with the finding. Only when the highlight or its page states one; otherwise empty.
- **Your take**: one line the reader types. When present, every draft contains it word for word as its own paragraph, and the rest is written to lead into it. Without it a draft has no first person and no opinion.
- **Numbers check**: every number in a draft, the headline or a takeaway must appear in the highlight, the page text, the title or the credit (or in the reader's take). Numbers the model computes or recalls are refused and repaired once, as any failed check is.
- The app, not the model, adds the source line, the link and the hashtags. LinkedIn: source line, then the link in the post or held back as a ready first-comment line. X: the link only. Instagram: source line, the link as plain text, hashtags.
- No stock ending and no question written to draw comments.
- Changing the destination or the take asks for the text again (one request, Undo keeps the earlier version). Changing the angle, the crop, the style, the look or the caption options asks for nothing.

## Contract

All shapes live in `src/shared/share-card.ts` (no zod, no Node, no DOM) with their zod schemas in `src/shared/share-card-schema.ts` (server only). The lead commits the new constants and types before the agents start; task T1 changes `Caption` and `ShareCardRecord`.

```ts
export const STYLES = ['page', 'headline', 'quote', 'idea', 'takeaways'] as const
export const TEXT_CARD_STYLES = ['quote', 'idea', 'takeaways'] as const
export const FIT = { width: 1080, minHeight: 608, maxHeight: 1350 } as const
export type CardSize = 'feed' | 'story' | 'fit'            // 'fit' applies to the Page style; other styles draw 'fit' as 'feed'

export const DESTINATIONS = ['linkedin', 'x', 'instagram'] as const
export type Destination = (typeof DESTINATIONS)[number]
export const ANGLES = ['finding', 'contrast', 'caveat'] as const
export type Angle = (typeof ANGLES)[number]

export const DESTINATION_DEFAULTS: Record<Destination, { style: ShareStyle; size: CardSize; extraLines: 0 | 1 | 3; showTags: boolean }>
export const DRAFT: Record<Destination, { minWords: number; maxWords: number; maxChars: number; hookMax: number; minParagraphs: number; maxParagraphs: number }> = {
  linkedin:  { minWords: 120, maxWords: 300, maxChars: 3000, hookMax: 140, minParagraphs: 3, maxParagraphs: 8 },
  instagram: { minWords: 80,  maxWords: 200, maxChars: 2200, hookMax: 125, minParagraphs: 2, maxParagraphs: 6 },
  x:         { minWords: 8,   maxWords: 60,  maxChars: 280,  hookMax: 280, minParagraphs: 1, maxParagraphs: 2 },
}
export const TAKE_MAX = 400      // on X a take raises maxChars to max(280, take.length + 140)

/** One highlight on the post's page: boxes as page fractions. */
export type PageMark = { rects: PageRect[]; color: HighlightColor }

export type CardContent = {
  // unchanged: quote, quoteEdited, emphasis, headline, pull, topic, takeawaysTitle, takeaways, style, look
  /** The reader's crop of the page, as page fractions; null means automatic. */
  crop: PageRect | null
}

// T1:
export type Caption = {
  destination: Destination
  /** The reader's line the drafts were built around, or ''. */
  take: string
  /** drafts.finding is never empty; the other two may be ''. */
  drafts: Record<Angle, string>
  angle: Angle
  hashtags: string[]                  // 3 to 5, always returned; shown when showTags
  showTags: boolean
  link: 'post' | 'comment'
  /** When set, replaces the composed text. */
  edited: string | null
}
export type ShareCardRecord = {
  // unchanged fields, plus:
  destination: Destination            // of the latest request
  take: string                        // of the latest request
  /** Every highlight now on the post's page, the post's own included; read live from annotations. */
  marks: PageMark[]
}
```

`CARD.headlineMax` rises from 60 to 80; T1 and T2 each make that one-line change on their branch, since both need it. `captionText(source, caption)` composes the chosen draft, the source line, the link and the hashtags by destination; `firstCommentText(source)` gives the LinkedIn first-comment line.

### Server API (T1)

Base `/api/projects/:projectId/share-cards`.

| Call | Body | Notes |
| --- | --- | --- |
| `POST` base | `{ request_id, annotation_id, destination?, take?, agent?, model? }` | `destination` defaults to `linkedin`. 202 created, 200 existing |
| `POST /:id/change` | `{ instruction?, destination?, take? }`, at least one | One request; the earlier version goes behind Undo. A destination change also sets the style to that destination's default |
| `PATCH /:id` | exactly one of `{ style, look }`, `{ crop }` (a `PageRect` or `null`), `{ angle }`, `{ show_tags }`, `{ link }`, `{ headline }`, `{ caption }`, `{ quote }`, `{ credit }` | `caption`, `quote` and `headline` keep an Undo step; the others are written in place. `angle` is refused when that draft is empty; choosing an angle clears `edited`, and keeps an Undo step when it does |
| `GET`, `retry`, `cancel`, `undo`, `DELETE` | as today | Undo also restores the destination and take of the version it returns to |

### Region and first-page posts (T5)

A post can start from a box the reader draws on a page (a figure, a table, an equation, a passage) or from the first page (title, authors and abstract). The image is that region of the PDF; the assistant sees only text.

```ts
export const SOURCE_KINDS = ['highlight', 'region', 'paper'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export const REGION_MIN = 0.05                 // of the page, in each direction
export const REGION_STYLES = ['page', 'headline'] as const
export const REGION_STYLE_REFUSED = 'A post made from a region has no quote or takeaways, so it uses the Page or Headline style.'

export type ShareCardSource = {
  // as before, plus:
  kind: SourceKind                             // a stored source without one is a highlight
  /** The box a region or first-page post started from; null for a highlight. */
  region: PageRect | null
  // For 'region' and 'paper': rects is [], color is 'yellow', and passage is the cleaned text read inside the region,
  // 0..CARD.passageMax characters (passageMin applies to highlights only).
}
export type ShareCardSummary = { /* as before, plus: */ kind: SourceKind }   // title: summaryTitle(source, headline)

regionProblem(region: PageRect): string | null  // null when ordered, inside the page and at least REGION_MIN each way
summaryTitle(source, headline): string          // the headline, else the passage's start, "Region on p. N", "First page" ("Paper on p. N" off page 1)
validateCard(card, source)                      // source.kind decides: a region card has only headline and topic
cardDescription(card, style, source?)           // "Page card: a region of page 3", "Page card: the first page of the paper", "Headline card: <headline>."
sharePostPrompt(destination, limits, kind = 'highlight')
```

| Call | Body | Notes |
| --- | --- | --- |
| `POST` base | `{ request_id, source_id, page, region, text, kind: 'region' \| 'paper', destination?, take?, agent?, model? }` | `region` is a `PageRect` (400 unless x1<x2, y1<y2 and at least 5% of the page each way); `page` must be in the PDF (422; without a stored page count the extracted text's pages decide); the source must be a PDF in this project (404 not found, 422 not a PDF); `text` is untrusted, at most `passageMax` after cleaning (422). Not unique per region: only `request_id` makes a retry idempotent. `annotation_id` is null |
| `PATCH /:id` `{ crop: null }` | | Returns the crop to `source.region`: these posts have no automatic crop, so `card.crop` is never null |
| `PATCH /:id` `{ style }` to a text card, `{ quote }` | | 400, with `REGION_STYLE_REFUSED` or "A post made from a region has no quote to edit." |

- The card has only `headline` and `topic`; `quote`, `emphasis`, `pull` and `takeawaysTitle` are `''` and `takeaways` is `[]`. Its first style comes from the destination as for a highlight; `crop` starts as the region.
- The answer is `{ headline, topic, drafts: { finding, contrast, caveat }, hashtags }`; any other card field is ignored. The draft rules, limits, take rule, leak checks and single repair are a highlight's. The numbers pool is the region text, the page text, title, credit, page and take; quotations must come from the region text or the page text.
- The request sends `{ regionText, pageText, title, credit, page }`, plus `readerTake`, the previous version (`previousCard` is `{ headline, topic }`) and `change` as for a highlight. The prompt shares every rule with a highlight's and differs in its opening, its card fields and one section: for `region`, find the caption in `pageText` ("Figure 3: …") and write about what the region shows according to it, never describing visual detail the text does not state; for `paper`, the finding says what the paper studied and its main result as the abstract states it.
- `marks` is every highlight on the post's page (none of them is the post's own). A region post survives its source being deleted and is reconnected when the source is restored, through the existing trash links on `source_id`.

### Renderer API (T2), in `frontend/src/lib/share-card/`

```ts
// crop-box.ts (pure)
autoCrop(rects: PageRect[], page: { width: number; height: number }, sheet: { width: number; height: number }, extraLines: 0 | 1 | 3): PageRect | null
// page-crop.ts
type PageCrop = { image: CanvasImageSource; width: number; height: number
  /** The crop drawn, as page fractions. */ box: PageRect
  /** The highlights inside it, as fractions of the crop. */ marks: PageMark[] }
pageCrop(fileUrl: string | null, source: ShareCardSource, options: { sheet: { width: number; height: number }; crop: PageRect | null; marks: PageMark[]; extraLines: 0 | 1 | 3 }): Promise<PageCrop>
// index.ts
type CardRenderOptions = { style: ShareStyle; look: ShareLook; size: CardSize; crop?: PageCrop }
renderCard, cardPng, cardLayout, cardSheetSpace   // as today, with the new styles and sizes
```

A reader's crop never fails for being too tall: the sheet is drawn narrower and centred. Only an automatic crop steps down through fewer lines of context.

### Crop editor (T3), `frontend/src/components/CropEditor.tsx`

```ts
type Props = {
  fileUrl: string; page: number
  /** The crop to start from, as page fractions. */ value: PageRect
  marks: PageMark[]
  /** null means "back to automatic". */ onApply: (crop: PageRect | null) => void
  onCancel: () => void
}
```

A modal that shows the whole page with the crop as a rectangle: drag inside to move, drag the eight handles to resize, arrow keys move the focused handle or the box (Shift for larger steps), "Reset to automatic", "Apply", "Cancel", Escape cancels. Minimum crop 10% of the page in each direction. Pure geometry in `frontend/src/lib/share-card/crop-edit.ts`.

## Compatibility and data

- **Schema stays at version 16.** It has never been in a published build. The table gains `destination TEXT NOT NULL DEFAULT 'linkedin'` and `take TEXT NOT NULL DEFAULT ''`. The only libraries that hold the first build's table are the owner's Windows preview library and the lead's scratch library, so the step drops a `share_cards` table that lacks the `destination` column and creates the new one. `master` at 15 migrates straight to the final shape.
- Posts are still never synced; `src/shared/sync/schema.ts` and `cloud/firestore.rules` do not change.
- Trash links for `share_cards` are unchanged.
- No telemetry events. No change to the assistants' restrictions. PDF text, the take and every stored field are untrusted data in the prompt.
- Platforms: the reader runs in the browser, the Windows app and the Linux app. The only desktop code is the copy-image bridge from the first build, already merged with master's Linux changes; it is not touched again. A native check of Copy image on Windows and Linux stays an owner gate.

## Tasks

Each task: write the failing test first, then the code; keep `npm run typecheck`, `npm test` and `npm run build` green; commit in small steps on the task's branch; never push.

### Stage 0: preparation (lead)

- [x] S0.1 Branch `feat/share-posts` from `feat/share-cards`, merge `origin/master`, resolve the five conflicts.
- [x] S0.2 Make the share-card test's fake Codex answer master's new agent probes.
- [x] S0.3 This plan.
- [x] S0.4 Commit the contract's new constants and types (`STYLES`, `FIT`, `CardSize`, destinations, angles, `DRAFT`, `PageMark`, `CardContent.crop`) with the smallest changes that keep everything compiling.

### Stage 1: the new post (three tasks in parallel, then one)

**T1 Server** (`share-posts/server`). Owns `src/shared/share-card.ts`, `src/shared/share-card-schema.ts`, `src/core/share-cards.ts`, `src/server/share-cards.ts`, the `share_cards` step in `src/core/database.ts`, `test/unit/share-card.test.ts`, `test/integration/share-cards.test.ts`, the share-card case in `test/integration/database-migration.test.ts`.
- T1.1 `Caption` and `ShareCardRecord` as in the contract; schemas; `captionText` and `firstCommentText` by destination.
- T1.2 The numbers check (`numbersIn`, `unsupportedNumbers`) with tests for thousands separators, decimals, percentages, years, ranges and the take.
- T1.3 The prompt and `parseShareCardAnswer` for three drafts per destination: limits from `DRAFT`, the take present word for word, empty `contrast` and `caveat` allowed, the numbers check, the existing exact-quote and leak checks.
- T1.4 The service: `destination` and `take` on start and change; default style by destination; `marks` read live; `crop`, `angle`, `show_tags`, `link` and `headline` edits; Undo restoring destination and take.
- T1.5 Routes as in the table; the schema step with the drop of the first build's table; migration test.
- May make the smallest edits needed in `frontend/src/components/SharePostPanel.tsx` and `frontend/src/lib/share-card-api.ts` so the frontend compiles; T4 rewrites them.

**T2 Renderer** (`share-posts/renderer`). Owns `frontend/src/lib/share-card/` except `crop-edit.ts`, `frontend/src/pages/ShareCardSamples.tsx`, `test/unit/share-card-layout.test.ts`, `test/unit/share-card-crop.test.ts`.
- T2.1 `autoCrop` with a context setting; a reader's crop scaled to fit; tests.
- T2.2 `pageCrop` with `crop`, `marks` and `extraLines`; every mark drawn in its own colour.
- T2.3 The Fit size for Page: height from the crop, clamped to `FIT`.
- T2.4 The Headline style on Feed and Story: topic, headline (up to 80 characters), the sheet, the credit strip. Without a crop it is laid out as Big idea.
- T2.5 The samples page shows the new frames; every style still fits at the contract's limits.
- May make the smallest edits needed in `SharePostPanel.tsx` so the frontend compiles.

**T3 Crop editor** (`share-posts/crop-editor`). Owns `frontend/src/components/CropEditor.tsx`, `frontend/src/lib/share-card/crop-edit.ts`, `test/unit/share-card-crop-edit.test.ts`, `frontend/src/pages/CropEditorSample.tsx` with the hidden route `/dev/crop-editor`, `frontend/e2e/crop-editor.spec.ts`.
- T3.1 Geometry: move, resize by handle, clamp to the page and the minimum size; tests.
- T3.2 The modal: page render through `lib/pdf-document.ts`, marks, pointer and keyboard control, focus handling.
- T3.3 A hidden sample page and a browser test that drags, resizes, resets and applies.

**T4 Panel and flow** (on `feat/share-posts`, after T1 to T3 are merged). Owns `frontend/src/lib/share-card-api.ts`, `frontend/src/components/SharePostPanel.tsx`, `frontend/src/components/HighlightMenu.tsx`, the share-post parts of `frontend/src/App.tsx` and `frontend/src/pages/ProjectView.tsx`, `frontend/e2e/share-cards.spec.ts`, `README.md`, the structure lines in `CLAUDE.md`.
- T4.1 Client calls for the new API.
- T4.2 Destination picker (the last one used is remembered on the device), "Your take" field with "Rewrite around my take", angle tabs that hide empty angles.
- T4.3 The image area: Page or Headline first, text cards under "Text cards", looks, "Adjust crop" opening the crop editor, the headline editable.
- T4.4 Caption options: hashtags on or off, link in the post or as a first-comment line with its own Copy button, a character count for X.
- T4.5 Export: Copy image, Save image; Story size offered for Instagram.
- T4.6 Browser tests for the whole flow with the API mocked; README section rewritten.

**G1 Gate** (lead): typecheck, `npm test`, build, frontend Playwright, desktop tests, secrets scan; a look at every frame on the samples page; the plan's result section filled.

### Stage 2: more ways to start

**T5 Region posts, server** (built on `share-posts/server`). A post without a highlight, as specified in "Region and first-page posts (T5)" under the Contract: `POST` base accepts `{ request_id, source_id, page, region, text, kind: 'region' | 'paper', destination?, take?, agent?, model? }`; `source.kind` and `source.region` record where it started; `rects` is empty and `crop` starts as, and resets to, the region. The prompt says the reader selected a region that may be a figure, a table, an equation or a passage (or is sharing the paper from its first page), gives the text inside it and the page text, and asks for the same drafts; the picture itself is never sent. The card has only a headline and a topic, and the text-card styles and quote edits are refused.

- [x] **T6 Region selection in the reader** (`share-posts/region-ui`). "Share a region" in the reader: drag a box on a page, collect the text inside it from the text layer, start the post. "Share the first page" in the Post tab: a region post of kind `paper` whose crop starts at the top of page 1. Browser tests with the API mocked.
  - Both start from the Post tab's post list, on the page in view and on page 1, through the crop editor (new optional props `title`, `applyLabel`, `resetLabel`, where `resetLabel: null` hides the reset). "Share a region" starts from a box in the middle of the page; "Share the first page" from the first line of text to the last above an "Introduction" heading, across the text's width (the top 55% of the text, or of the page without text, when there is no such heading).
  - `frontend/src/lib/share-card/region-text.ts` (pure, `test/unit/share-card-region-text.test.ts`): the words whose centre is inside the region, in reading order (left column before right where the lines leave a gutter), one line per text line, cleaned as `cleanPassage` cleans and cut at a line break to `CARD.passageMax`; `firstPageRegion`; and `pageTextRuns`, which reads a loaded pdf.js page.
  - `shareCardApi.startRegion` keeps a reload-safe request ID per source, page, kind and region. The panel hides text cards and Edit quote for these posts, labels the reset "Back to the original region", passes the source to `cardDescription`, and draws Big idea from the headline when the PDF is gone. Post lists label them "Region" or "First page" instead of "Highlight deleted".
  - Browser tests in `frontend/e2e/share-regions.spec.ts` with the fixture `test/fixtures/share-regions.pdf` (`make-share-regions-pdf.mjs`).

**G2 Gate** as G1.

### Stage 3: several highlights, one post

Designed after G2. A reader picks two to eight highlights from one PDF and gets a carousel: the format whole-paper posts use on Instagram and, as a document, on LinkedIn.

**Behaviour**

- The slides, in order: a cover (topic and a headline that works as the hook); the study in one sentence, when the text states what was studied; one slide per highlight (a short claim above that highlight's page crop, drawn like the Headline style, with every highlight inside the crop); the takeaway; the limitations, when the text states any. Every slide carries the credit strip and its number ("3 / 7").
- Slides are 1080 x 1350 for every destination. The destination still sets the text's length and options.
- The text is the same three drafts, written about the set as a whole.
- The reader can edit every slide's words, adjust the crop of each highlight slide, and choose the look. The highlights' order is chosen when the post is made.
- Export: copy or save the slide in view; save all slides as one ZIP of PNG files; save all slides as one PDF (a LinkedIn document). Both files are built in the browser with no new dependency.
- The post keeps its own copy of each highlight's words and boxes, so it outlives them.

**Contract**

```ts
export const SET = { minItems: 2, maxItems: 8, studyMax: 160, pointMax: 70, takeawayMax: 140, limitationsMax: 160 } as const
export type SetItem = { annotation_id: string | null; passage: string; page: number; rects: PageRect[]; color: HighlightColor }
// ShareCardSource: kind gains 'set'; `items: SetItem[]` ([] for every other kind). For a set: passage is the items'
// passages joined by blank lines, page is the first item's page, rects is [], region is null, and context is the
// text of the items' pages within CARD.contextMax.
export type SetContent = { study: string; points: string[]; takeaway: string; limitations: string; crops: Array<PageRect | null> }
// CardContent: `set: SetContent | null` (null for every other kind). For a set the card has headline and topic,
// no quote and no takeaways, points.length === crops.length === items.length, and its style is always 'headline'.
export type SlideSpec =
  | { kind: 'cover'; kicker: string; headline: string }
  | { kind: 'study' | 'takeaway' | 'limitations'; kicker: string; text: string }
  | { kind: 'point'; kicker: string; headline: string; item: number }
export function setSlides(card: CardContent, source: ShareCardSource): SlideSpec[]   // pure; kickers are the topic, 'The study', 'The takeaway', 'Limits'
```

Server: `POST` base also accepts `{ request_id, source_id, annotation_ids: string[], kind: 'set', destination?, take?, agent?, model? }` (2 to 8 highlights of that source, in the reader's order, each passing the highlight rules). The answer is `{ topic, headline, study, points: string[], takeaway, limitations, drafts, hashtags }`; `points` has one claim per highlight in order; `study` and `limitations` may be `''`. The numbers check, the take rule and the single repair apply to all of it. `PATCH /:id` gains `{ set_text: { field: 'study' | 'takeaway' | 'limitations' | 'point', index?, text } }` (keeps an Undo step; the cover uses the existing `{ headline }`) and `{ crop, slide }` for one highlight slide's crop. Text-card styles, `quote` edits and `{ style }` other than the looks are refused for a set. Summaries read "N highlights" until there is a headline.

Settled in T7:

- **Request.** `{ request_id, source_id, annotation_ids, kind: 'set', destination?, take?, agent?, model? }`. Refusals, without a request: fewer than 2 or more than 8 ids, or an unknown field (400); a repeated id (400, "Choose each highlight once."); a source not in this project (404, "Source not found."); not a PDF (422); an id that is not a highlight of that source (404, "Highlight not found."); a highlight outside the single-highlight limits (422, "Highlight N is too short for a post." / "... too long ..."). A set is not unique: only `request_id` makes a retry idempotent, and a highlight may be in any number of sets and in its own post. The row's `annotation_id` stays null.
- **Source.** `items` copy each highlight's id, cleaned passage, page, boxes and colour in the reader's order; `passage` is their passages joined by blank lines (the schema allows `passageMax` per item for a set, `passageMax` in all for the other kinds); `page` is the first item's; `color` is `'yellow'`. `context` is `sharedContext(pages, itemPages)`: each distinct item page once, in page order, the budget shared so that a short page keeps all its text and the longer ones split the rest equally, each cut at its end. Deleting a highlight changes nothing in the post: `items` keep their `annotation_id`, and the live marks fall back to the stored boxes.
- **Request sent.** `{ highlights: [{ page, text }], pageText, title, credit }` plus `readerTake`, the previous version (`previousCard` is `{ headline, topic, study, points, takeaway, limitations }`) and `change` as for a highlight. The numbers pool adds every item's page; quotations come from the highlights or the page text; messages name the field as the answer does (`points[2]`, `study`, ...), and "highlights" as the source text.
- **Checks on the slides.** `headline`, `study`, every point, `takeaway` and `limitations` pass a draft's checks on the assistant's own words: no hashtags, links, Markdown, leaks or first person; quotations exact; numbers from the source. `study` and `limitations` may be empty; whether they should be cannot be checked and is left to the prompt.
- **Card.** The first version and every later one: style `'headline'`, `crop` null; a later version keeps the look and `set.crops`. A destination change does not change the style.
- **Edits.** `{ crop, slide }`: `slide` is the index of the highlight (0-based, the `item` of its `SlideSpec`), not the slide's number. Written in place and kept through Undo, like the single crop. Refused: `{ crop }` without `slide` on a set ("A carousel has a crop for each highlight slide; name the slide."), a `slide` past the last highlight, `slide` on any other post ("Only a carousel has slides."). `{ set_text: { field, index?, text } }`: `index` is required for `point` and refused otherwise; `text` is collapsed to one line; limits are `SET`'s; on another post, "Only a carousel has slide text.". `{ style, look }` with a style other than `'headline'` is refused with `SET_STYLE_REFUSED`; `{ quote }` with "A carousel has no quote to edit.".
- **Marks.** `ShareCardRecord.set_marks: PageMark[][]`: for a set, one list per item, every highlight now on that item's page with the item's own (its stored boxes when it was deleted); `[]` for every other post. `marks` is unchanged for single-page posts and is `set_marks[0]` for a set.
- **Shared helpers.** `setSlides(card, source)` (a point slide's kicker is the topic, as the cover's; points beyond the source's items are not drawn; `[]` for a card without `set`); `cardDescription` reads "Carousel of N slides: <headline>."; `summaryTitle` gives "N highlights" before there is a headline; `SET_STYLE_REFUSED`.

Renderer (`frontend/src/lib/share-card/slides.ts`): `renderSlide(slide, context, options)` draws one slide from a `SlideSpec`-shaped value with the layout engine's existing parts: the cover and the text slides as a headline card without a pull quote, a highlight slide as the Headline style. `context` carries the credit strip's fields, the look, the slide's number and count, and, for a highlight slide, its `PageCrop`. Export helpers, pure and tested in Node: `pdfFromJpegs(pages)` (one page per slide) and `zipStore(files)`.

**Tasks**

- [x] **T7 Carousel, server** (`share-posts/server`): the contract above, the prompt variant for a set, parsing and checks, start, the two new edits, `setSlides`, tests.
- [x] **T8 Carousel, renderer and export** (`share-posts/renderer`): `slides.ts`, the slide number in the credit strip, a kicker that is not the topic, the PDF and ZIP writers, sample frames for every slide kind.
- [x] **T9 Carousel, panel** (on `feat/share-posts`, after T7 and T8): choosing and ordering highlights, the slide viewer, per-slide edits and crops, export, browser tests, README.
- [x] **G3 Gate** as G1.

### Stage 4: three cards for Instagram

Owner decision of 16 November 2026, after the live check: on Instagram a post from one highlight, region or first page is a small carousel, not one card.

**Behaviour**

- A new style, **Carousel**, draws the post as three slides of 1080 x 1350: the hook (topic and headline), the evidence (the page crop with the reader's highlights, no headline), and the takeaway (one sentence on why the finding matters). Each slide carries the credit strip and its number ("2 / 3").
- Carousel is the default style for Instagram. The reader can still choose Headline, Page or a text card there, and can choose Carousel for LinkedIn and X.
- The takeaway is written by the same single request, for every post. A post made before this has none and shows two slides until it is rewritten or the reader types one.
- The reader edits the headline, the crop and the takeaway; export is the slide in view, all slides as a ZIP, or one PDF, as for a carousel of several highlights.
- When the PDF file is gone, the evidence slide is drawn from the quote, or from the headline when there is no quote.
- In a carousel of several highlights, the limits slide never repeats a highlight's own point: when a highlight is itself the limitation, `limitations` is empty.

**Contract**

```ts
export const STYLES = ['page', 'headline', 'carousel', 'quote', 'idea', 'takeaways'] as const
// DESTINATION_DEFAULTS.instagram.style is 'carousel'. STYLE_NAMES.carousel is 'Carousel'. CARD.takeawayMax is 140.
// CardContent gains `takeaway: string`: one sentence, 1 to 140 characters, or '' for a post stored before it
// existed and for a set (which keeps its own in set.takeaway).
export type SlideSpec = /* as before */ | { kind: 'page'; kicker: string; fallback: string }
/** The slides of a post drawn in the Carousel style; [] for a set. */
export function postSlides(card: CardContent, source: ShareCardSource): SlideSpec[]
// cover { kicker: topic, headline }, page { kicker: topic, fallback: quote or, without one, headline },
// takeaway { kicker: 'The takeaway', text } when card.takeaway is not ''.
```

Server: every answer carries `takeaway` (the take rule, numbers check, leak checks and the repair apply to it); `PATCH { takeaway }` edits it and keeps an Undo step; `{ style: 'carousel' }` is allowed for highlight, region and first-page posts and refused for a set. Renderer: `renderSlide` draws a `page` slide as the Page style at Feed with the slide's number; without a crop it draws `fallback` as a text slide.

Settled in T10:

- **Answer.** Highlight, region and first-page answers gain `takeaway`; a set's answer keeps its own `takeaway`, which goes to `set.takeaway`, and the card's stays `''`. The answer's takeaway is 1 to 140 characters after collapsing whitespace; it passes the checks every other piece of the assistant's own words passes (numbers, leaks, quotations, first person, links, hashtags, Markdown), may not end on a question, and may not be the headline again (compared ignoring case, whitespace and final punctuation). Whether it is an instruction to the reader is left to the prompt. "The take rule" applies as it does to the headline: only the drafts carry the take, and the takeaway has no first person.
- **Prompt.** One new line per single-post kind: the takeaway is what follows from the headline's claim, not the claim again. The numbers rule names the takeaway. For a set, the limitations line says never to repeat a point; the check refuses a `limitations` that is a point again (same comparison as above).
- **Card.** `validateCard` allows `''` to 140 for a single post (so stored cards read) and refuses a non-empty `card.takeaway` on a set. `REGION_STYLES` is `['page', 'headline', 'carousel']` and `REGION_STYLE_REFUSED` names Carousel. A set refuses `carousel` with `SET_STYLE_REFUSED`. A previous version sent with a change includes `takeaway` (for a region: `{ headline, topic, takeaway }`).
- **Edit.** `PATCH { takeaway }`: collapsed, 1 to 140 characters ("A takeaway needs 1–140 characters."), not number-checked, behind Undo; on a set, 400 "A carousel of several highlights keeps its takeaway on its own slide; edit it with { set_text: { field: 'takeaway' } }.".
- **Types.** `setSlides` returns `SetSlideSpec[]` (`SlideSpec` without the `page` kind, which a set never has), so code that shows a set's slides need not handle `page`. `postSlides(card, source)` takes any value with `kind`. `cardDescription(card, 'carousel', source?)` reads "Carousel of N slides: <headline>." counting `postSlides`.

**Tasks**

- [x] **T10 Server** (`share-posts/server`): the contract, the prompt and checks for `takeaway`, the edit, `postSlides`, the rule for a set's limitations, tests.
- [x] **T11 Renderer** (`share-posts/renderer`): the `page` slide, its fallback, sample frames.
- [x] **T12 Panel** (on `feat/share-posts`, after T10 and T11): the slide viewer for the Carousel style, the style choice, the takeaway edit, export, browser tests, README.
- [x] **G4 Gate** as G1.

## Acceptance criteria

Stage 1:
1. A new post from a highlight opens on the Page style for LinkedIn and X and on the Headline style for Instagram, with every highlight inside the crop drawn in its colour.
2. The reader can change the crop with the pointer and with the keyboard, apply it, and reset it; the preview and every export use it.
3. A post offers the finding draft always and the other two angles only when the answer contains them; picking an angle changes the copied text without a request.
4. With a take, every draft contains the take word for word; without one, the prompt forbids first person.
5. A draft, headline or takeaway with a number that is not in the source is repaired once and then fails with the fixed message; the test suite covers it.
6. The copied text follows the destination: lengths within `DRAFT`, the source line, link and hashtags as in the table above.
7. Changing the destination or the take makes exactly one request and can be undone; nothing else makes a request.
8. A library holding the first build's `share_cards` table opens, and a library at version 15 migrates, both to the final table.
9. No zod in any browser bundle; no telemetry event; no live assistant request in any test.
10. Typecheck, `npm test` with its coverage thresholds, build, frontend Playwright, desktop tests and the secrets scan pass on the final revision.

## Validation that stays with the owner

- Live drafts: reading real answers for each destination and angle (no live request is made without the owner's go-ahead).
- Copy image in the Windows and Linux apps; pasting into LinkedIn, Instagram and X.
- Whether the lengths and angles read right in practice.

## Ground rules for every agent

- Work only in the worktree and on the branch named in your brief. Do not switch branches, push, open a pull request, or touch another worktree.
- Do not edit `desktop/version.json`, `desktop/src/main.mjs`, `desktop/src/preload.cjs` or `frontend/src/desktop.d.ts`.
- Make no live assistant request and run no real assistant binary. Tests fake the assistant (see the fake Codex in `test/integration/share-cards.test.ts`) or mock the API (see `frontend/e2e/share-cards.spec.ts`).
- Tests use `testConfig()`; never the home library.
- Add no telemetry. Keep zod out of everything the browser imports.
- Stay inside the files your task owns, apart from the compile fixes it names. If the contract above cannot work as written, stop and report instead of changing it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Result

### G1 and G2: stages 1 and 2 (16 November 2026)

Revision `3429cba6f7bd8340028bc8d90de7ce4cb510750a` on `feat/share-posts`, not pushed. Built by parallel agents on task branches (`share-posts/server`, `share-posts/renderer`, `share-posts/crop-editor`, `share-posts/region-ui`) and merged by the lead.

| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npm test` | 363 tests: 362 pass, 0 fail, 1 skipped (Firebase rules, no emulator). Lines 88.18%, branches 85.16%; `src/core/share-cards.ts` 99.45% lines, `src/server/share-cards.ts` 100% |
| `npm run build` | passes |
| Frontend Playwright | 147 passed |
| `npm --prefix desktop test` | 75 passed |
| `node scripts/check-secrets.mjs` | passed for 516 files |

Tasks done: T1 to T6, plus a follow-up to T2 (automatic crops snap to whole lines and the highlight's text column, and grow to fill the card's room).

Differences from the plan as first written:

1. The automatic crop reads the page's text layer. It never cuts a line, keeps to the highlight's column on a two-column page, and treats the destination's lines of context as a minimum, growing until the card is full. A page without a text layer keeps the first build's rule.
2. "Share a region" and "Share the first page" open the crop editor on the page instead of a drag mode in the reader, so both work with the keyboard. The first-page box is worked out from the text: from the first line to the line before the Introduction heading.
3. An angle that replaces hand-edited text keeps an Undo step.
4. Checks added to the assistant's answer beyond the plan: first person without a take, stock endings and closing questions, quotations of six or more words that are not in the source, and `contrast` or `caveat` that repeat the finding.
5. On X a draft may be 255 characters when the source has a link, so the copied text with its link stays within 280.
6. The source line under the text keeps the first build's form (title, credit, page).
7. A region post whose PDF is gone is drawn as a Big idea card from its headline.
8. A real bug found by a flaky test: on a touch screen a tap on Apply straight after a quick drag was swallowed by the browser. The crop editor now cancels touch moves during its own drags; the test reproduces the case every run.
9. `frontend/playwright.config.ts` takes its port from `PDFPAL_E2E_PORT`, so two checkouts can run browser tests at once.
10. `CARD.caption*`, `hookMax` and `defaultStyle` from the first build are gone; `DRAFT` and `DESTINATION_DEFAULTS` replace them.

Still unchecked:

- No live assistant request has been made on this branch. The prompts for highlights, regions and first pages, and the first-person, stock-ending and quotation checks, are unread against real answers.
- Copy image in the Windows and Linux apps; pasting into LinkedIn, Instagram and X.
- Real PDFs: two-column papers, scanned pages and rotated text have unit tests and made-up pages only; the browser tests use small one-column fixtures.
- A real touch screen and a screen reader.
- The Windows preview library holds the first build's table; opening it with this build drops those posts.

### G3: stage 3 and the review fixes (16 November 2026)

Revision `8dbdc1ae06efac91f35bcfc0211651d24933064f` on `feat/share-posts`, not pushed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npm test` | 399 tests: 398 pass, 0 fail, 1 skipped (Firebase rules, no emulator). Lines 88.52%, branches 85.56%; `src/core/share-cards.ts` 99.56% lines, `src/server/share-cards.ts` 100% |
| `npm run build` | passes; no zod in `frontend/dist/assets` |
| Frontend Playwright | 168 passed |
| `npm --prefix desktop test` | 75 passed |
| `node scripts/check-secrets.mjs` | passed for 524 files |

Tasks done: T7 to T9, and the fixes from an independent review of stages 1 and 2 (11 confirmed defects and 8 plausible ones, all fixed with a test that failed first, except the two noted below).

What the review changed:

1. The numbers check no longer lets a thousands reading match a smaller number ("10,000" against a "10" in the source), and it is lenient on the source side only: digits glued to a word, number words up to thousands, abbreviated ranges.
2. The checks on the assistant's words use Unicode-aware boundaries; "C#" is not a hashtag; an exact quotation across a line-end hyphen passes; a quotation chopped by ellipses or in single curly quotes is checked; bare domains count as links; a draft with a take must have words of its own.
3. A reader's edited quote survives a rewrite of a short highlight. A look, style, hashtag or link change made after the last Undo step survives Undo, as the crop does.
4. A stored post that no longer parses is left out of lists, answers 422 with a plain message, and can be deleted.
5. The panel: "Adjust crop" stays available when the automatic crop is too tall; status checks retry with backoff and say when they stop; a crop is not redrawn on every check; no image URL is left behind when a post closes mid-render; a refused start forgets its request ID.
6. The region picker stays on the page it opened on, and region text is chosen word by word.
7. A carousel's source line names the pages its highlights span.

Left as they are, on purpose or for later:

- An angle chosen after an Undo step is not kept through Undo; Undo returns the angle of the earlier version.
- A post that no longer parses and belongs to a highlight is left out of the lists, so "Create post" on that highlight shows the message without a post to delete. Only a first-build post restored from the trash in a test library can be in that state.
- A number's sign is not checked: "-12%" in the source supports "12%" in a draft.
- One browser test ("a new post for linkedin opens on its frame") timed out once in one agent run, on the highlight menu moving under the pointer; it passed in every other run, including 18 repeats and three whole-suite runs. Its cause was not found.

Still unchecked, beyond the list under G1 and G2:

- No live assistant request for carousels either: whether points stay one claim per highlight, and whether the study and limitations come back empty when the text does not state them.
- The exported PDF as a real LinkedIn document, and the ZIP opened in Windows Explorer or macOS Finder.
- Export time and memory for an eight-slide carousel on long pages.
- The status-check retry against a real backend restart.

### Live check, round 2 (16 November 2026)

Revision `250c5d1`, with the owner's go-ahead: 14 requests to Codex against a temporary library with two arXiv papers (Mistral 7B, QLoRA). All 14 completed in 12 to 51 seconds; the number of repairs is not recorded anywhere and could not be measured. The answers and the cards drawn from them are kept outside the repository, in the owner's study folder (`live-round-2`).

Covered: a highlight for each destination (one post rewritten for all three), a take, a figure caption with a hedge, a stated limitation, two regions (a figure, a table), two first pages and two carousels of three highlights.

- Numbers lead the drafts and are the paper's own; one checked by hand against its table was right. Hedges are kept. The take appears word for word. `contrast` came back empty in the three cases where the text states no assumption. Region posts used the caption and the page text and described no visual detail. The stock ending of the first round is gone.
- Seen and left as they are (the owner asked for one change only, stage 4): a caveat built from "the scope of the comparison" when the text states no limitation (4 of 14); LinkedIn drafts that close on "the paper's central result is…"; LinkedIn drafts of 131 to 175 words, the low end of the range.
- Seen and fixed: in a carousel, the limits slide repeated a highlight's own point (stage 4); a four-line highlight in an abstract with tight leading was refused as too tall for an automatic crop, because line boxes that overlap by a sliver chained into the whole abstract (fixed in `crop-box.ts` with a unit test and a property test over 400 random layouts; revision `afdc983` passes the whole gate: 400 unit tests, 168 browser tests).
- Real pages drew as intended after that fix: abstracts, a figure, a table, a caption, a page with a table beside the text.

A Windows preview `2.8.0-posts.1` built from `250c5d1` was installed beside the released app (it does not have the crop fix).

### G4: three cards for Instagram (16 November 2026)

Revision `8ce8d615f2f0b50827897b61fb281507517e8e27` on `feat/share-posts`, not pushed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npm test` | 412 tests: 411 pass, 0 fail, 1 skipped (Firebase rules, no emulator). Lines 88.57%, branches 85.68%; `src/core/share-cards.ts` 99.57% lines, `src/server/share-cards.ts` 100% |
| `npm run build` | passes; no zod in `frontend/dist/assets` |
| Frontend Playwright | 181 passed |
| `npm --prefix desktop test` | 75 passed |
| `node scripts/check-secrets.mjs` | passed for 525 files |

Tasks done: T10 to T12. Instagram posts from a highlight, a region or the first page open in the Carousel style: the hook, the page, the takeaway. A post stored before the takeaway existed shows two slides and offers "Add a takeaway".

Still unchecked: the takeaway's wording and the set's limitations rule against real answers (no live request since they were written); the three exported cards posted to Instagram; Copy slide in the desktop apps.
