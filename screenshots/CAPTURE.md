# README media capture

The README leads with a demo video. The still images described further down were embedded in the README until the video replaced them on November 16, 2026; they are retained here, with their capture tooling, as reproducible stills.

## Demo video — November 16, 2026

The video shows one reading session in the browser reader built from `master` at `1b8b33c` (2.8.0-beta.7). The desktop app hosts the same reader; the video does not show native Windows or Linux window decorations. The file is hosted as a GitHub attachment and is not in this repository.

**What is real.** Every click, drag, scroll and keystroke was performed in the running app by a Playwright script. The seven AI results are live, unedited Codex CLI output, one request each, with no retakes: the decoder-masking answer, the visual explanation, the LinkedIn post and its rewrite around a take, the paper post and its rewrite for Instagram, and the project chat answer. Paper search results came from the live discovery service. No API responses, application markup or styles were replaced.

**The library.** An isolated temporary library holds four sample projects with 32 public arXiv papers: *Transformer Architecture* (three collections), *Harness Engineering*, *Retrieval-Augmented Generation* and *Diffusion Models*. Thirty-one were imported beforehand through the CLI; *Attention Is All You Need* (v7) is added on camera through paper search. Project descriptions, the Markdown note and the "Your take" line are sample content. No personal library or account settings were read.

**What the recording adds.** The pointer and its click ring are drawn by the recording script as an overlay that does not receive events; a headless browser has no visible pointer. Scrollbars are hidden by a browser flag. Chromium ran headless on Linux at 1120 × 756 CSS pixels and a device scale factor of 2, using Windows' Segoe UI fonts. **Dark pages** is enabled.

**Editing.** Takes were cut, cropped and zoomed, and a caption strip, a title card and an end card were added. Waits for the assistant are shortened and carry a "sped up" tag; they ran from about ten seconds to two and a half minutes. Navigation, scrolling and typing are also sped up, without a tag. The segment that switches the paper post to Instagram lost its frame timestamps and is shown at a fixed frame rate, so its pacing is approximate. The saved visual explanation and the saved carousel were stepped through in separate takes that made no request.

The recording scripts and the edit definition are kept by the maintainer and are not part of this repository.

## Browser reader stills — November 15, 2026

These reader images come from the browser interface built from the default branch, `master`, including the second-generation visual renderer and offline dictionary. The desktop app hosts the same reader; these captures do not claim to show native Windows or Linux window decorations. [`capture-manifest.json`](capture-manifest.json) records the base application commit (the refresh changes only documentation/tooling), capture time, viewport, fixture and step count.

| Image | View | Viewport |
| --- | --- | --- |
| `reader-decoder-masking.png` | Page 3, saved decoder highlight and original Codex discussion | 1600 × 1000 |
| `visual-attention-steps.png` | Page 4 beside a token/score/weight figure, step 7 of 9 | 1600 × 1000 |
| `visual-attention-expanded.png` | Expanded query/key plot, step 5 of 9 | 1600 × 1000 |
| `reader-dictionary.png` | WordNet definition of “stack” selected in the actual PDF | 1600 × 1000 |
| `2-related.png` | Page 3 beside loaded references from the real discovery service | 1600 × 1000 |
| `3-search.png` | Loaded OpenAlex search for “Attention Is All You Need” | 1600 × 1000 |
| `4-projects.png` | Browser home with three sample workspaces | 1600 × 1000 |
| `5-notes.png` | Rendered sample Markdown research note | 1600 × 1000 |
| `6-collections.png` | Expanded collections with imported public papers | 1600 × 1000 |
| `8-extension-setup.png` | Matching companion download and connection instructions | 1600 × 1000 |
| `backups-recovery.png` | Backup settings after a verified backup of the temporary library | 1600 × 1000 |

**Dark pages is enabled in the PDF reader captures.** This changes figure colors as well as text/background colors. The divider, page scrolling, selection popup, dictionary and visual controls are operated in the actual app. Discovery results come from live public services after loading; later captures may contain different results and citation counts.

The capture uses an isolated temporary SQLite library and a fresh browser context. It imports public PDFs for *Attention Is All You Need* (v7), *Neural Machine Translation by Jointly Learning to Align and Translate*, and *FlashAttention*. A second managed copy of the attention paper separates the visual study from the decoder discussion. Projects/descriptions and the Markdown research note are sample content. No personal library or account settings are read. No API responses, markup or styles are replaced.

The decoder response is restored unchanged from [`paper-reading-example.json`](paper-reading-example.json), which preserves its original generation provenance. The visual is restored unchanged from [`attention.claude.json`](../test/fixtures/visual-v2/attention.claude.json), a recorded real model response also used by the visual regression suite. Its question was “how attention works in a transformer”, with **no supplied passage or source references**. The original background/illustration labels remain visible; the nearby PDF does not imply that this answer was generated from a selection. The example numbers are illustrative, not measured paper results. The capture makes **zero new provider calls**, with provider executables set to unavailable paths.

[`9-visual-explanation.html`](9-visual-explanation.html) is downloaded with the real **Export HTML** action, including the same renderer and bundled font as the app. The capture checks all nine steps and endpoint controls in the app, then opens the exported file with networking disabled and checks every exported caption and the final disabled Next button.

## Reproduce the current captures

From the repository root:

```sh
npm ci
npm exec --workspace frontend -- playwright install chromium
npx tsx scripts/capture-readme.ts
```

`npm ci` builds the app through the prepare hook; run `npm run build` again after application changes. The script chooses a free loopback port, deletes its temporary library/profile afterward and writes the images, HTML and manifest above. It needs network access for the three public PDFs and paper discovery, but no model authentication. If public services fail, the script fails instead of capturing loading placeholders or fabricating results. Set `PLAYWRIGHT_EXECUTABLE_PATH` to use an existing Chromium binary.

For a separate live reading session, [`capture-visual-example.ts`](../scripts/capture-visual-example.ts) accepts an already-running server and saved session/visual IDs. It supports both stored visual formats. It writes the older example filenames and provenance JSON, so review those outputs before replacing the curated README set.

## Retained Windows evidence — November 6, 2026

`desktop-menu.png` was captured from the installed Windows desktop preview **2.7.0-preview.2** through Electron's local debugging port, at 1600 × 1000. It shows the native integration unavailable in a browser-only capture. It is kept as dated evidence and is not presented as a fresh Windows validation; the README no longer embeds it. Native caption controls are outside a renderer screenshot; see the separate [Windows shell evidence](../docs/evidence/windows-shell.md) for the full frame.

`visual-softmax-scaling.png` and the visual definition in `paper-reading-example.json` are retained as the original-format historical example. The stills above and `9-visual-explanation.html` use the new attention fixture instead. Historical evidence and original model answers are preserved rather than relabeled as newly generated content.
