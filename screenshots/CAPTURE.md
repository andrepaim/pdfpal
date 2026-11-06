# README screenshot capture

Captured on **2026-11-06** from the installed Windows desktop preview,
**2.7.0-preview.2**, matching [`desktop/version.json`](../desktop/version.json).
Playwright connected to the actual Electron renderer through its local debugging
port. These are renderer screenshots; Windows' native caption-button overlay is
outside that capture. The full native frame is shown in the separate
[Windows shell verification](../docs/evidence/windows-shell.md).

The app used a dedicated temporary library and desktop profile with sample
projects. No regular library content or account settings were used. No API
responses, application markup, or styles were replaced for the screenshots.

| Image | View | Viewport |
| --- | --- | --- |
| `reader-decoder-masking.png` | Page 3, highlighted decoder passage and saved discussion | 1600 × 1000 |
| `visual-softmax-scaling.png` | Page 4, highlighted scaling passage and visual step 1 of 3 | 1600 × 1100 |
| `2-related.png` | Page 3 and loaded references from Semantic Scholar | 1600 × 1000 |
| `3-search.png` | Loaded paper search for “Attention Is All You Need” | 1600 × 1000 |
| `4-projects.png` | Projects home with the Windows toolbar | 1600 × 1000 |
| `5-notes.png` | Rendered sample Markdown note | 1600 × 1000 |
| `6-collections.png` | Expanded collections with imported papers | 1600 × 1000 |
| `8-extension-setup.png` | Current companion download and pairing instructions | 1600 × 1000 |
| `desktop-menu.png` | Windows app menu | 1600 × 1000 |
| `backups-recovery.png` | Backup settings and the demo library's scheduled backup | 1600 × 1000 |

**Dark pages is enabled in all three PDF reader screenshots.** Highlights were
saved through the reader's selection popup. The reader divider and scroll
positions were adjusted through the app to keep each passage beside its
explanation. Paper search and related-paper results came from the running app's
real discovery services, after loading completed.

The reading answers and visual definition are the original, unedited Codex output
in [`paper-reading-example.json`](paper-reading-example.json), replayed in the
temporary library. Their original generation provenance remains in that file.
This refresh made no new AI requests. The interactive
[`9-visual-explanation.html`](9-visual-explanation.html) still corresponds to that
saved definition. All three visual steps and navigation back to the first step
were checked in the current renderer.

The sample library imports the real PDFs for *Attention Is All You Need* (v7),
*Neural Machine Translation by Jointly Learning to Align and Translate*, and
*FlashAttention*. A second copy of the attention paper keeps its visual discussion
separate from its decoder discussion. Project descriptions and the research note
are demonstration content.

For another refresh, use an isolated library/profile, import those public papers,
and restore the saved reading examples without editing their answers. Open the
views above, enable Dark pages, wait for PDF canvases, fonts and discovery results,
and capture the renderer at the listed viewport sizes. Keep sample content
separate from the regular library. The existing
[`capture-visual-example.ts`](../scripts/capture-visual-example.ts) also supports
capturing genuine reading sessions from the browser reader.
