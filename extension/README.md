# pdfpal Kindle Companion

A Chrome side panel for reading Kindle books with pdfpal. The interface follows pdfpal's right chat pane: a dark theme, indigo question bubbles, Markdown answers and a composer fixed at the bottom. Ask general questions about the open book, attach a selection for a focused question, and save passages or answers as project notes.

Book questions use the book title and author, conversation history, previously discussed or saved excerpts and the agent's general knowledge. The context hint below the composer identifies book chat or an attached selection. The companion does not read the entire Kindle book, and its prompt tells the agent to distinguish supplied evidence from background knowledge. Optional project PDFs can add retrieved source text. Capture and export work independently; chat and project saving need the updated local pdfpal server.

## Install

Companion **0.5.0** is bundled with the repository's pdfpal **2.1.0** build. That pdfpal version has not yet been published to npm; use a source checkout until it is released:

```sh
npm ci
npm run build
npm start
```

1. In pdfpal, choose **Extension** from the projects home or **Kindle extension** from a project.
2. Click **Download Chrome extension** and extract the ZIP to a folder you will keep.
3. Open `chrome://extensions` in desktop Chrome, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Pin **pdfpal Kindle Companion** to the toolbar. Open Kindle for Web and refresh an already-open book tab.
5. Click the toolbar icon to open the panel. This action also grants screenshot permission for region capture.

Contributors can load `extension/dist` directly after the root build. The archive is generated at `extension/package/companion.zip`; no manual packaging step is needed.

Supported readers: `read.amazon.com`, `ler.amazon.com.br`, and `read.amazon.co.uk`. English prose is the initial OCR target. The native Kindle PC application is not supported.

The side panel is available only on supported Kindle tabs. Switching to another site hides it; returning to the Kindle tab restores an already-open panel. Navigating that tab away from Kindle closes its panel. The toolbar icon remains available, but opens the panel only on Kindle.

For updates, replace files in the installed folder and click **Reload** on its existing Chrome entry, then refresh Kindle. Do not remove the extension first: removal clears its stored connection. Restart pdfpal when updating the server too.

### One-time upgrade to a stable extension ID

Version **0.3.1** adds a fixed public `key` to the manifest, using Chrome's [supported mechanism for a consistent development ID](https://developer.chrome.com/docs/extensions/reference/manifest/key). Earlier builds had a folder-dependent identity, so loading a newly extracted folder could create a separate extension with no saved connection. This was why the previous update asked to pair again.

Installing 0.3.1 from an earlier build changes its identity once and requires a fresh pairing. After that, reloads and updates retain the pinned identity and local connection. The regression test verifies pairing across Chrome's Reload action, loading a higher version from another directory and restarting the browser. Removing the extension or clearing its data still removes its saved connection; [Chrome documents this storage behavior](https://developer.chrome.com/docs/extensions/reference/api/storage#local).

The pinned ID is `billjanehfdgcakkbbefbjobocjlinen`. Keep the checked-in manifest key unchanged in future builds; it is public identity material, not a login token or private signing key. The build validates the key and prints the ID.

## Connect once

1. Start pdfpal with `pdfpal serve` (or `npm start` in a source checkout).
2. Click **Connect to pdfpal** in the companion.
3. In the local browser tab, review the access description and click **Allow connection**.
4. Return to Kindle and choose a project. A single project is selected automatically; an empty library offers **Create project**.

The request expires after five minutes. You can close the panel during approval and reopen it to finish. **Open approval tab** reopens a lost tab, **Cancel** stops the request, and **Retry** reconnects after a stopped server. Normal reloads, browser restarts, and updates keep the same connection and conversations.

For a different server port, expand **Address & manual pairing** and enter the address shown on pdfpal's Extension page. Only HTTP loopback addresses (`127.0.0.1` or `localhost`) are accepted. Disconnect before switching an established connection to another server.

The web **Extension** page lists paired connections and lets you name or revoke them. Disconnecting keeps notes and stored records but revokes access. Removing the extension or losing its credentials requires fresh pairing; that new connection does not automatically inherit the old connection's private conversations. A connection can access all projects: the project picker selects context, not a permission scope.

### Manual fallback and CLI management

An older server can still use a single-use code:

```sh
pdfpal extension pair
# In a source checkout:
node dist/cli/index.js extension pair
```

Expand **Address & manual pairing**, paste the code, and click **Connect to pdfpal**. Generate it using the same data directory as the running server. Codes expire after five minutes.

```sh
pdfpal extension list
pdfpal extension revoke <connection-id>
```

## Capture a passage

- Selecting native text while the panel is open attaches it above the composer automatically. **Selection** in the composer also captures a passage explicitly. For Kindle image-rendered pages, it attempts to crop the highlighted rectangles from the rendered page image and run OCR.
- **Region** lets you drag a rectangle around visible text, then recognizes that region from a screenshot. Press **Esc** to cancel. This path is useful when Kindle's image or selection structure cannot be read.
- The attached selection appears in a compact banner. **Review** opens the passage editor, book details and OCR image comparison. The book's information button also opens these details without needing a selection. Metadata is best effort and remains editable; no PDF page number is invented.
- **Remove selection** switches back to book chat and preserves your typed question. Sending a selection question consumes its attachment, so the next question defaults to book chat. The original passage remains attached to its turn in the conversation.
- **Copy Markdown**, **Export JSON** and **Discard capture** are available inside **Review**. Exports preserve the reviewed text, original recognition and provenance; JSON excludes image data.

The extension keeps one draft per tab in browser session memory. Closing the tab, navigating to another book URL, restarting Chrome or reloading the extension clears that tab's draft. Reopening the side panel preserves a draft in the same tab. Export passages you want to keep. If recognition was interrupted by closing the panel, reopen it and choose **Retry OCR**.

## Discuss and save

Once connected and a Kindle book is open:

- Ask a general book question immediately; capturing a passage first is optional. The book title is read from Kindle and can be corrected in **Book details** if necessary.
- With a selection attached, **Explain passage** asks your configured agent to unpack it. You can also type your own question about the quote.
- Use the send arrow or Enter to ask; Shift+Enter adds a line break. Follow-ups retain this book's recent conversation and the passage and location used for each turn. Messages scroll independently while the composer stays visible.
- **Include relevant project PDFs**, in settings, adds retrieved passages from the selected project's indexed PDFs. This is off by default. A project with no PDFs still supports book and selection chat.
- **Save passage** creates a normal project note containing the reviewed quote, book details, Kindle location and URL.
- **Save answer** beneath a response saves the question, answer, book details and original selection when present. The note opens in pdfpal's existing note editor.
- **Clear** removes this book's conversation in the selected project. It preserves saved project notes and is disabled while an answer is running.

Conversations are persisted locally per paired connection, project and book. Capturing another passage from the same book retains its conversation; switching projects or books changes the conversation. Metadata matching is best effort when a book has no stable ID.

You can close the panel during an answer and reopen it later. The backend job continues, and retries use the original request ID to avoid invoking the agent twice. A server restart interrupts an unfinished answer and reports it as failed rather than automatically replaying a possibly billable request. Completed turns and saved notes remain available. Repeated saves of the same passage or answer in the same browser session return the existing note.

OCR code, WebAssembly and English language data are bundled with the extension. OCR needs no remote service or model download. Screenshots remain in browser session memory; only the cropped, normalized passage is retained after recognition, and images are not sent to pdfpal. Asking or saving sends reviewed text and its provenance to the paired local server. AI requests use your configured agent and provider, with optional selected-project PDF context. Markdown and math rendering reuse pdfpal's reader components.

## Explain visually

Use a slash command for graphical explanations with your configured agent, including Codex. Type `/visual how attention works` in the chatbox. With a passage attached, `/visual` alone explains that selection; add a question after the command to focus the explanation. Ordinary questions continue to produce text answers.

The chatbox placeholder mentions `/visual`. Typing `/` shows a command suggestion and an example; click it or press Tab to complete `/visual`. Submitting a bare command without an attached selection shows usage guidance without invoking an agent. The previous checkbox and extra **Explain visually** buttons have been removed. In pdfpal's web PDF reader, **Explain visually** is available directly in the text-selection popup.

An explanation contains topic-specific diagrams in progressive steps. Use the arrows to move between scenes and select a shape to reveal additional detail. **Expand** opens a larger viewer. Captions distinguish supplied text, illustrative examples and background knowledge; relevant source labels appear beneath each step. **Read the explanation** and **Takeaways & full transcript** provide text alternatives. Follow-up questions use the conversation context.

**Save to project** creates a note with the transcript and a link to the preserved interactive explanation in pdfpal's web interface. **Export HTML** downloads a standalone interactive file that works offline. Visual explanations persist with conversation history; reopening the pane does not regenerate them. Failed generation can be retried explicitly. A server restart interrupts unfinished generation and does not replay it automatically.

Scenes use validated vector shapes and bundled interactions. The model cannot supply executable HTML or JavaScript. Generated examples can simplify a concept, so the captions and detailed explanation identify the intended scope. Arbitrary numerical simulations and sliders are outside this first release.

## Troubleshooting

- **Refresh the Kindle tab** after loading or reloading the extension, so its content script is present.
- **Region capture requests permission:** click the extension's toolbar icon while the Kindle tab is active, then try again. Opening the panel through Chrome's side-panel menu alone may not grant screenshot access.
- **No selection found:** use **Capture region**. Kindle can render words as images instead of native text.
- **The page changed:** wait until navigation and layout settle, then capture again. The companion rejects OCR completion after a location, page image, viewport, URL or reader interaction changes.
- **Missing title or location:** fill in the fields manually. Live regional reader metadata still needs validation.
- **Poor OCR:** increase the book font size and capture a smaller passage. Dark themes are normalized automatically. Code, equations and tables need careful correction.
- **Cannot reach pdfpal:** start or restart the updated server and check its port. Your usual global installation might still be an older version; `npm run dev` in this checkout runs the updated source.
- **Request expired or connection revoked:** click **Connect to pdfpal** and approve a new request. If using manual pairing, generate a fresh code. A stopped server or provider authentication error does not require a new pairing.
- **Agent failed:** check that the agent configured in pdfpal is installed and authenticated. Fix the agent setup, then submit a new question.

## Development and verification

Guided pairing tests cover allow/deny/expiry/cancel, interrupted requests, lost claim responses, project selection, and connection management. Package smoke tests install and exercise the downloaded artifact outside the checkout. The pinned identity and update regression protect existing connections.

```sh
npm run build
npm run test:extension
npm test
npm run test:archive
npm run test:package
```

Tests use a fresh Chromium profile, synthetic reader pages and original text. They exercise frame selection, actual local OCR, stale-result rejection, session drafts, export metadata and region screenshots. Browser integrations pair with a real temporary pdfpal server and fixture agents, recover a 32-second answer after reopening, render Markdown/math and save idempotent notes. Layout checks cover metadata-only book questions, automatic native selections, removing attachments without losing input, consumed selections, dark message colors and a visible composer at 320px and 390px widths. Backend tests cover saved excerpt context, scoped clearing, authority, isolation, optional research and migrations. They do not log into Amazon, invoke a real AI provider or access existing personal data.

Install Playwright's Chromium if necessary:

```sh
npm exec --workspace extension -- playwright install chromium
```

Set `PLAYWRIGHT_EXECUTABLE_PATH` to use an existing Chromium binary. `HEADED=1 npm run test:extension` runs with a visible browser. Region action automation uses the modern Chromium DevTools Extensions domain, so use the bundled test browser rather than an old Chrome installation.

## Live checks

Capture has been reported working on the user's Kindle setup. Broader checks should still cover multiple books, light/dark themes, font changes, window resizing and column layouts. The confidence number is the OCR engine's estimate, not measured transcription accuracy.

After installing, pair once, ask a question using the configured agent and open a saved project note. After an ordinary update, verify that the saved connection still works. Check that switching the book or project changes the conversation and that titles and locations are correct or manually corrected. Full-book indexing, automatic Kindle highlight synchronization and guaranteed exact-location navigation remain separate work.

Third-party OCR components: Tesseract.js and Tesseract.js-core (Apache-2.0), and `@tesseract.js-data/eng` (package license MIT). Available upstream license files are included under `ocr/` in the build.
