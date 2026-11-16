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

**T7 Carousel, server**: a post made from two to eight highlights of one source: one request returns a hook, the study in one sentence, one line per highlight, a takeaway and, when the text states them, limitations.
**T8 Carousel, renderer and export**: one 4:5 slide per part with the credit strip on each; the set saved as PNG files and as one PDF for a LinkedIn document.
**T9 Carousel, panel**: choose highlights in the Highlights tab, reorder slides, export.
**G3 Gate** as G1.

Stage 3 is designed in detail after G2, because its slide types reuse what stages 1 and 2 settle.

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

To be filled at each gate: revision, checks and results, differences from this plan, what is still unchecked.
