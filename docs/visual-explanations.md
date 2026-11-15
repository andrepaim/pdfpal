# Visual explanations

Use **Explain visually** in a PDF selection popup, or type `/visual <question>` in PDF chat, project chat or the [Kindle companion](../extension/README.md#explain-visually). With a passage attached, `/visual` alone explains that passage. Typing `/` shows a suggestion; Tab completes the command. Without an attached passage, supply a question after `/visual`.

Try `/visual how attention works in a transformer` in project chat. No PDF is required for a general-concept question. In the reader, select a passage first to ask about that specific text. PDF selections include their page and nearby page context when available; Kindle questions use captured excerpts and book metadata, with project PDFs included only when enabled in the companion.

## Read a figure in steps

New explanations use the second-generation figure renderer. The assistant supplies content and data; pdfpal lays out flow diagrams, plots, token/vector grids, comparison tables, bar charts and quadrants. A figure can reveal several steps before moving to the next figure. Existing saved explanations from the original format still open.

- Choose **Next** or **Back**, click a segment in the progress bar, or focus the player and use **Left/Right arrow** keys. Groups of segments correspond to figures; the counter shows the current step across the whole explanation.
- Items marked with a dot have additional detail. Select one to open its named explanation; keyboard users can focus it and activate it.
- **Read more** expands the current step's explanation. **Takeaways and full transcript** includes every step and a text alternative for the figure content.
- **Expand** opens a larger, centered viewer on the current step. Navigating there also updates the embedded player. Close it to return to the page.

Captions label **Based on supplied text**, **Illustrative example** or **Background knowledge**. Source labels identify supplied references. Worked numbers are examples unless identified as source data; a plot is not an arbitrary numerical simulation. Generated explanations can contain mistakes: compare the steps with the passage and ask a focused follow-up when something is unclear.

## Save, reopen and export

**Save to project** creates a Markdown note with the transcript and a link to the preserved interactive explanation. Reopening a completed explanation uses the saved definition without another model call.

**Export HTML** downloads a self-contained interactive file using the same figure renderer as the app. It includes figures, captions, text alternatives, navigation and a bundled font, and works without pdfpal or an internet connection. Keep the file when sharing or moving an explanation: an app-local note link requires its original library. [Download the recorded attention example](../screenshots/9-visual-explanation.html).

Local [library backups](backup-recovery.md) include interactive definitions. Cloud conversation sync carries saved text, but **interactive visual assets stay local**. A synced transcript or note does not transfer its interactive asset to another device.

## Generation and recovery

Creating an explanation uses the configured assistant and its provider allowance. The waiting card shows elapsed time; most requests take one to two minutes, and complex requests can take longer. Invalid output gets one automatic correction attempt before generation fails. A reported failure offers an explicit **Retry**, which makes another provider request.

Completed explanations persist in history. A server restart interrupts unfinished generation and does not automatically replay it. Reopen the conversation and retry after checking assistant authentication in **AI settings**. See the [Kindle guide](../extension/README.md#discuss-and-save) for closing the side panel while a job is running.

For contributors, the stored formats and renderer live in [`src/shared/visual.ts`](../src/shared/visual.ts), [`visual-frames.ts`](../src/shared/visual-frames.ts) and [`visual-kit/`](../src/shared/visual-kit/). The player and HTML exporter share that renderer. Figure output is validated data, not model-supplied executable HTML or JavaScript.
