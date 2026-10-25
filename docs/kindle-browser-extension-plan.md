# Kindle browser extension feasibility and implementation plan

Date: 2026-10-23

Status: Capture and Codex chat reported working on the user's Kindle setup. Version 0.3 adds pdfpal's dark chat layout, optional selection attachments and general book questions without requiring a capture.

This document records the original feasibility work and early implementation. For the current plan to make the extension a first-class interface, including guided pairing, distribution, documentation, and integration into master, see [the detailed task checklist](extension-first-class-tasks.md). Version references and test totals below describe those earlier stages.

## Decision

Build a Chrome Manifest V3 companion extension for Kindle for Web. The intended flow is: open the pdfpal side panel, capture a passage, review the text, and explain or discuss it using the existing local pdfpal service. Save useful passages and answers into a chosen project.

The architecture is feasible. The main uncertainty is passage capture in the current Kindle renderer. Native browser selection must be treated as an optional fast path. Plan for OCR of a user-selected visible passage and an editable preview.

This extension can work independently of the multi-format source roadmap. It provides passage-based assistance; access to an entire book is a separate capability.

## Evidence and validation boundaries

| Capability | Evidence | Conclusion |
| --- | --- | --- |
| Browser side panel | Chrome's supported Side Panel API; successful `sidePanel.open()` call in the probe | Supported and API-tested; visual usability still needs a headed browser check |
| Extension to local pdfpal | An extension page fetched `/api/health` and `/api/projects` from a real temporary pdfpal server with current CORS settings | Verified without broadening server CORS |
| Selection in a child frame | An original HTML fixture at an intercepted Kindle-shaped URL contained a `srcdoc` iframe; its content script captured selection and passed it through the extension worker | Frame messaging and origin-fallback injection verified; this fixture does not reproduce Kindle's renderer |
| Selection survives panel focus | The captured passage was stored in extension session storage and read from the panel page | Verified in the isolated probe |
| Current Kindle text access | A maintained Kindle translation extension uses image crops and Tesseract OCR, including Kindle selection geometry | Strong implementation precedent; not a test against this user's books |
| Title, book ID and location | Existing implementations observe Kindle UI changes; metadata layout and regional differences need inspection | Pending live test; allow manual correction and missing location |
| Chat without a local PDF | Current `ChatService.ask` throws `NO_CONTEXT` when no indexed passages exist | Requires a new external-passage context path |
| Whole-book access and reliable return to an exact location | No such capability was established by this investigation | Outside the first release |

The isolated probe ran on Chromium 149.0.7827.55 with a fresh browser profile and temporary database. It loaded an unpacked Manifest V3 extension, captured an original passage in a frame, successfully invoked the side-panel API, and fetched actual pdfpal data from an extension page. The panel document was also opened as an extension tab for inspection. This does not establish visual side-panel behavior, Kindle compatibility, OCR accuracy, or AI response quality.

The probe used no Amazon account, existing user project, or AI invocation. No signed-in Kindle session was available to this investigation.

## What the Kindle evidence changes

The older [ReaderTools implementation](https://github.com/prestix-studio/ReaderTools/blob/6390ad81e34560a6607c0490cf0ffbcbf191e310/script.js) hooks Kindle's own selection menu and reads text nodes. Its latest commit is from 2019, and it uses Manifest V2. It is historical evidence, not a suitable foundation for a new extension.

The [current Kindle translation extension](https://github.com/motiko/kcr-translate-ext/tree/fb7373d445bdea197b93c7abd9bee21388b28717), last committed on 2026-10-06, instead identifies selected rectangles and crops the rendered page image for OCR. Its [capture code](https://github.com/motiko/kcr-translate-ext/blob/fb7373d445bdea197b93c7abd9bee21388b28717/chrome/content/kindle/utils.ts) also normalizes dark page images. This supports an OCR-based approach, but its selectors remain specific to Kindle's current UI.

Use native text only when the current page exposes it. Prefer a visible selection or user-drawn region over hooks into Kindle's private application state. A Kindle-specific adapter can later improve the selection and metadata experience.

## First release experience

1. Start pdfpal and connect the extension once using a local pairing flow.
2. Open a book in Kindle for Web and open the extension side panel.
3. Select a passage and choose **Capture passage**. If native text is unavailable, capture the selected image region. Offer **Capture region** so the user can drag a rectangle when Kindle selection geometry cannot be read.
4. Show the extracted text in an editable preview, with its book title and available location. Clearly mark OCR text. Missing location does not prevent asking a question.
5. Choose a pdfpal project and **Explain**, **Ask a question**, or **Save passage**. The preview itself remains local until the user submits an action.
6. Continue the conversation in the panel. Save a passage or an answer as a project note, including its provenance and a link to the book.

The AI receives the reviewed passage, the user's question and conversation history through pdfpal's configured agent. Project PDF retrieval is an explicit optional context choice. There is no full-book context by default. OCR can run locally, while AI processing uses the provider configured in pdfpal.

## Architecture

```text
Kindle tab
  content adapter: selection, region coordinates, visible metadata
      |
  extension worker: tab identity, capture action, session draft state
      |
  extension side panel: local OCR, editable preview, conversation, notes
      |
  authenticated loopback bridge on the existing pdfpal server
      |
  project services, external passage context, agent invocation, SQLite
```

The side panel is bundled with the extension. Kindle stays in its own tab. Extension pages make requests to pdfpal using loopback host permission; content scripts do not fetch the local API directly. This follows Chrome's [extension networking model](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Keep the AI request out of the extension service worker. The current pdfpal chat route sends its answer only after agent invocation completes, which can take several minutes. Chrome can terminate a worker when a fetch response takes more than 30 seconds to arrive. Use a short request that creates a backend job, then retrieve its result from the panel. Persist job and session IDs so reopening the panel can recover the conversation. See Chrome's [worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Initial browser target: desktop Chrome. Check Edge separately after the Chrome acceptance gate. Start with unpacked installation; store submission is a later distribution step.

### Capture adapter

- Prefer a nonempty native selection when it belongs to the reader frame.
- For image-rendered text, locate selected rectangles and the rendered image when accessible. Crop only those rectangles and recognize them locally.
- If direct image access fails, test a user-invoked visible-tab screenshot and crop the selected region. This requires an appropriate `activeTab` grant; host access alone must not be assumed sufficient. See [`captureVisibleTab`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab).
- Keep a manual region selection fallback so Kindle selector changes do not necessarily break capture.
- Bind every capture to a tab, frame, book identity, and navigation generation. Reject stale asynchronous results after a book switch, page turn, zoom change, or region change.
- Preserve the last explicitly captured passage when focus moves to the panel; never attach a newly displayed book's metadata to an old passage.
- Keep title, author, book ID and location separate. Use the displayed Kindle location label rather than inventing a PDF page number. Allow corrections and null values.
- Book links should reopen the book where supported. Promise exact-location return only after the relevant URL format has been verified on the user's regional reader.

### OCR

Use a bundled browser OCR engine such as Tesseract.js, initially for English prose. Test Portuguese separately before claiming support. Package worker code, WebAssembly, and initial language data locally; configure extension CSP for WebAssembly as required. Tesseract documents [local asset paths](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), and Chrome documents [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).

Run OCR in a Web Worker owned by the panel for the first version. If the panel closes during recognition, keep the passage draft or ask for a fresh capture on reopening. Avoid an offscreen-document subsystem until persistent OCR work is needed.

Show progress, retry and editable text. Mathematical notation, tables, code, small text and multi-column layouts need separate accuracy checks. The first release should explicitly support prose and allow manual text correction rather than present OCR output as an exact transcription.

### Local bridge and pairing

Add a dedicated `/api/extension/*` route group on the existing loopback server. Keep the existing same-origin web application flow intact.

- Pair through pdfpal's local UI or CLI using an expiring code with bounded attempts. The exchange returns a revocable token for this extension installation.
- Require the token for extension routes and scope it to the extension features. Keep it in extension-only storage with trusted-context access; content scripts and page scripts must not receive it.
- Bind pairing to the initiating local session and extension origin; validate host and origin on pairing requests. Never expose a token through a reader-page message or a URL.
- The panel owns backend requests. Its worker accepts a small typed capture protocol, validates the sender and tab, and cannot be used as an arbitrary fetch proxy.
- Restrict destinations at runtime to a configured loopback endpoint. Request only relevant Kindle regional hosts and loopback access. Grant screenshot access through a user action.
- Do not enable wildcard CORS or grant Amazon's page origin access to local project data.

These are requirements for the new bridge, not a proposal to redesign all existing server authentication.

### Backend changes

| Existing area | Required change |
| --- | --- |
| `src/core/chat.ts` | Accept explicit external passages as valid context, including for an otherwise empty project; support explicit session identity; optionally combine them with selected PDF retrieval |
| `src/core/database.ts` | Add external document and capture records, associate captures with conversations, and store location metadata without PDF page fields; use the existing migration and backup mechanism |
| `src/server/app.ts` | Register scoped bridge routes with validated payloads, token checks, pairing, project listing, capture persistence, chat jobs and note creation |
| `src/core/agents.ts` | Reuse the existing configured agent invocation; isolate external excerpts as quoted context |
| `src/core/notes.ts` | Reuse project notes with a quoted passage, book metadata and book URL; add structured capture linkage where needed |
| New `extension/` workspace | Manifest, worker, Kindle adapter, OCR worker, side panel, settings and packaging |
| Existing frontend Markdown components | Reuse formatting and math normalization where dependency boundaries permit; keep API access and layout specific to the panel |

Suggested additive records:

- `external_documents`: provider, regional origin, external book ID when known, canonical URL, title and author.
- `external_captures`: project ID, external document ID, reviewed text, original OCR text when applicable, capture method, optional location label and structured locator, capture time and idempotency key.
- Session-to-document and message-to-capture associations: retain the exact context used by each turn, keeping separate books and projects in separate conversations.
- Extension pairing records and recoverable chat jobs with explicit status and request IDs.

Do not represent captured passages as fake PDFs or put Kindle locations into `page_number`. The existing source and annotation models assume PDF pages and rectangular coordinates. External records can later be reconciled with the multi-format locator design.

Proposed bridge operations: pair/revoke, list projects, create capture, open/read conversation, start/read chat job, and save note. Capture and chat submission need idempotency keys so a timeout or panel reload cannot create duplicates or invoke the agent twice.

## Milestones and acceptance gates

### 1. Validate capture on live Kindle

Build a diagnostic unpacked extension before the full sidebar product. Test at least two representative books in a signed-in session, including the regional reader actually used. Check native selection, image capture, selected rectangles, book identity, visible location and the region fallback.

Record at least ten prose captures across light and dark themes, resized windows, font changes and one/two-column layouts. Proposed target: at least 98% word accuracy on ordinary prose, no silently truncated passage, and a correctable result on every supported capture. Measure OCR latency; target a warm capture within five seconds on the development machine and report cold-start/model-load time separately. These are acceptance targets, not measured results.

Proceed when capture produces useful, reviewable text without disrupting Kindle navigation. If selection geometry is unreliable but manual region capture works, ship region capture first. If neither path works on representative books, stop the Kindle-specific build and retain manual paste as a narrower companion feature.

### 2. Add the bridge and external passage chat

Implement pairing and scoped endpoints, the additive capture/session model, and asynchronous chat requests. Demonstrate a question answered from a captured passage in a project with zero PDFs, followed by a second turn that retains the passage. Verify explicit optional research context and citations that distinguish Kindle locations from PDF pages.

### 3. Build the reading sidebar

Implement connection status, project selection, capture/review, explanation, questions, follow-ups and save-to-note. Bind drafts and sessions to the originating book and tab. Provide clear behavior when pdfpal is stopped, OCR fails, an agent fails, the panel closes, or the active book changes.

### 4. Verify and package

Add fixture tests for DOM selection, image-only rendering, nested frames, stale captures, dark images and metadata changes. Add backend tests for empty-project passage chat, cross-project/session boundaries, invalid tokens, malformed captures, idempotent retries and note provenance. Test slow AI responses beyond 30 seconds and reopening the panel during a request.

Repeat live acceptance on the target Kindle reader after the packaged build. Install the unpacked extension on the user's reading setup before considering Chrome Web Store distribution. Automatic highlight synchronization, full-book indexing, native Windows app integration and guaranteed exact-location navigation remain separate follow-up work.

## Companion implementation delivered

The unpacked extension is implemented in `extension/`. Build it with `npm run build:extension` and follow [the installation instructions](../extension/README.md). It provides native frame selection, image-selection OCR, region screenshot OCR, editable passage and book details, browser-session drafts, Markdown copying, JSON export, local pairing, AI conversations and project-note saving. English OCR assets are bundled for local processing.

The main interface now mirrors the web reader's right chat pane: the same dark palette and font stack, an AI Chat header, indigo user bubbles, Markdown answer bubbles, a scrollable history and a fixed bottom composer. Connection settings and passage review live in dialogs. Native selections attach automatically while the panel is open; image-based text uses the Selection or Region controls. Attachments can be dismissed without losing the question and are consumed after sending, including when the panel is reopened.

Book chat requires only the book metadata. It can use the agent's general knowledge, earlier discussed passages and saved excerpts from the same book, paired connection and project. The prompt distinguishes these sources and states that the full Kindle text has not been imported. Selection chat sends the exact reviewed quote. Scope is stored in the existing capture JSON, so older conversations remain compatible without a schema change. Clear removes the current conversation and preserves project notes.

Seven automated browser tests pass, covering native child-frame text, edits and export provenance, actual local OCR in light and dark images, stale OCR rejection, cancellation, navigation clearing and real screenshot capture after a toolbar action. The original light/dark prose fixtures are transcribed exactly after normalizing whitespace. This is fixture evidence, not a measured accuracy rate on Kindle books. The extension typecheck and existing full application build also pass. A 390-pixel panel preview was visually inspected.

The chat integration test uses a real temporary server and fixture agent. It pairs, saves a passage, reopens the panel during an answer taking over 30 seconds, renders Markdown and math, asks a follow-up, saves its answer, verifies retry-safe notes and switches projects without mixing history. A second chat-layout test covers book questions before any capture, native selection attachment/removal, retained question text, one-use attachment state across reopening, dark bubble colors and a visible composer at 320px and 390px widths. The 82-test backend/CLI suite passes, including metadata-only book chat, saved excerpt context, scoped clearing, error-output handling, token authority, idempotent requests and migrations. Automated tests use fixture agents; real-provider checks are separate from that suite.

`src/core/kindle.ts` provides passage-based chat separately from the PDF-only `ChatService`. Schema version 7 adds pairing/client records, Kindle conversations, immutable per-turn capture JSON and idempotent note-save records. Each turn doubles as a persisted asynchronous job. Regular PDF chat and page-based source models keep their existing behavior. Saved excerpts and discussions use the existing project-note service and editor. Conversations belong to a paired connection, project and regional book identity.

The screenshot test caught a Chrome permission detail: opening the panel through automatic panel behavior did not grant screenshot access. The implementation opens it from the toolbar action listener, and the test verifies the resulting `activeTab` grant through an actual screenshot. No all-sites screenshot permission is requested.

The dependency audit reports 21 findings affecting packages already present in the repository; none are on newly introduced package paths. Existing dependency versions were retained.

## Reading setup update

Reload the updated extension, refresh Kindle and restart the updated pdfpal server. Generate a code with `pdfpal extension pair`, connect in the sidebar, choose a project, ask a question and save the answer as a note. User-reported capture success supports proceeding with this integration; the broader multi-book capture checks remain useful. Full-book indexing and automatic highlight synchronization are outside this implementation.
