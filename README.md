<img src="frontend/public/favicon.svg" alt="pdfpal: an open book and AI conversation bubble" width="80" height="80">

# pdfpal

> **AI to read deeper, not to avoid reading.**

**Use the AI subscription you already pay for to help you read PDFs and Kindle books.** pdfpal puts chat and visual explanations beside the page through **Continue with ChatGPT** in the Windows app, or Claude Code, Codex, or OpenCode, with no additional pdfpal subscription.

There's a lot of vibe researching going on: skim an AI summary, watch an explainer, walk away feeling like you read the paper. Understanding lives in the details those shortcuts flatten: the assumptions, the derivation, the limitations. But going back to reading alone, getting stuck on page 4, and grinding through missing background isn't the answer either. That suffering was never the point. With pdfpal, you read the actual text while AI sits beside the page, unpacking the passage you're stuck on and keeping you moving.

Your library, notes, highlights, and chat history are stored locally. Optional cloud sync can share library metadata and, with separate consent, saved PDF and project conversations between devices. Relevant context goes to your configured AI provider when you ask for help; its terms, charges, and usage limits still apply.

Available as a **Windows desktop app**, a **Linux desktop engineering preview**, or a **CLI and browser reader on Linux/WSL**, with an optional Chrome companion for Kindle for Web.

## See pdfpal in action

[Install and run](#install-and-run) · [Quickstart](#quickstart) · [Documentation](docs/README.md)

https://github.com/user-attachments/assets/9014a985-5a21-41a6-9084-6f9d5dece3ec

One reading session with [*Attention Is All You Need*](https://arxiv.org/pdf/1706.03762v7), recorded in the browser reader, which the desktop app shares. The answers are live Codex output and the waits are shortened. See [how it was recorded](screenshots/CAPTURE.md).

| In the video | What happens |
| --- | --- |
| [**Find**](#sources--discovery) | Search for a paper by title and add it to a project organized into collections. |
| [**Ask**](#reading--chat) | Select the decoder-masking passage in §3.1 and ask why the inputs are shifted too. The answer works through a short target sequence. |
| [**Visualize**](#visual-explanations) | Choose **Explain visually** on the √dₖ scaling sentence in §3.2.1 and step through the explanation. |
| [**Keep**](#organization) | Save a highlight and write what you understood as a Markdown note. |
| [**Share**](#share-what-you-read) | Turn the highlight into a LinkedIn post built around your own take, then the whole paper into an Instagram carousel. |
| [**Connect**](#reading--chat) | Ask one question across several papers in project chat. |

Not in the video: the [offline dictionary](docs/reader-guide.md#offline-dictionary), [related papers](#sources--discovery), the [Kindle companion](#read-a-kindle-book) and [backups](#backups-recovery--privacy). To step through a visual explanation without installing anything, download the [exported example](screenshots/9-visual-explanation.html), which works offline.

## Install and run

| Choose your setup | What you need | Get started |
| --- | --- | --- |
| **Windows desktop preview** | Windows 11 on an Intel/AMD 64-bit computer. No separate Node.js or Git installation for pdfpal. | [Install the Windows app](#windows-desktop-preview) |
| **Linux desktop engineering preview** | x86-64 Debian/Mint/Ubuntu desktop. Node.js 22+ to build; installed app includes its runtime. | [Linux build, installation and acceptance](docs/linux-quickstart.md) |
| **Linux / WSL: CLI and browser reader** | Git and Node.js 22 or newer. | [Install from source](#linux-and-wsl) |

### Windows desktop preview

1. [Open the official GitHub Releases page](https://github.com/andrepaim/pdfpal/releases) and download the **pdfpal-Setup-…-x64.exe** installer from the newest desktop release, marked **Pre-release**.
2. Run the installer, then open **pdfpal** from the Windows Start menu. If upgrading, quit the running app from its tray menu first.
3. In AI settings, choose **Continue with ChatGPT** to use eligible plan allowance directly, or choose an installed coding agent.
4. Create a project, import a PDF, and start reading. See the [PDF quickstart](#read-a-pdf) below.

The Windows app has an integrated dark title bar with native window controls. Use **pdfpal menu** at the top left (or **F10**) for settings, backups, privacy and the Kindle extension. **Ctrl+K** finds a project, and the back/forward buttons retrace your reading history.

Closing the window keeps pdfpal running in the system tray near the clock. Click the tray icon to reopen it; use **Quit** in its menu to stop the app.

To browse and manage your library from the Windows ChatGPT app, open **pdfpal menu → Command line & ChatGPT**, choose **Install skill**, then **Check setup**. Current Windows installers include the matching CLI. Keep pdfpal running in its tray, open ChatGPT's **Skills → Installed**, and look for **Pdfpal CLI**. Try: “Show my pdfpal projects.” The setup check verifies the CLI connection; verify skill discovery in ChatGPT separately.

If ChatGPT's **Settings → General → Agent environment** selects WSL, the skill must also be available in that WSL distribution's `~/.agents/skills`. Windows, Ubuntu, and Ubuntu-24.04 use separate skill locations. Link the managed Windows skill into the distribution ChatGPT actually uses; see the [Windows CLI guide](docs/windows-cli.md) for commands and troubleshooting. The skill's WSL adapter operates your Windows library through the running app.

The Windows installer is currently an **unsigned engineering preview**, so Windows may show an unknown-publisher prompt. To upgrade between previews, download the target installer from GitHub Releases and install it under the same Windows account. The tray’s **Check for updates** only looks for signed stable releases when you request a check. See the [Windows upgrade instructions](docs/windows-quickstart.md#upgrade-or-uninstall) for checksum and installation steps.

### Linux desktop engineering preview

The x86-64 Debian package targets Mint 22/Ubuntu 24.04, with X11 as the initial validation environment. Download the `.deb`, `pdfpal-linux-release.json` and `SHA256SUMS-linux.txt` from the newest desktop release on the [GitHub Releases page](https://github.com/andrepaim/pdfpal/releases), which publishes Windows and Linux together, then check `sha256sum -c SHA256SUMS-linux.txt` in the download directory. Newer engineering artifacts are available from [CI](https://github.com/andrepaim/pdfpal/actions/workflows/ci.yml), or build from source using the [Linux quickstart](docs/linux-quickstart.md).

Install with `sudo apt install ./pdfpal-<version>-amd64.deb`, then open **pdfpal** from the application menu. The app includes its runtime and a separate `pdfpal-desktop-cli`; a system Node installation is unnecessary for those bundled tools. Node-based assistant CLIs may need their own runtime. The shared **pdfpal menu** offers settings, backups, CLI setup, licenses and updates inside the native Linux window frame. **F10** opens it; **Ctrl+K** finds a project. Closing the Linux window quits the app. Account persistence requires a supported, unlocked OS keyring; local reading works without sign-in. Wayland, live account flows and clean-machine installation remain manual acceptance checks.

### Linux and WSL

Install **Git** and **Node.js 22 or newer**. For AI features, also install and authenticate a supported assistant CLI: `claude`, `codex`, or `opencode`.

Run these commands in your Linux or WSL terminal:

```bash
git clone https://github.com/andrepaim/pdfpal.git
cd pdfpal
npm ci
npm start
```

`npm ci` runs the build automatically through its prepare hook. After changing source code, rebuild with `npm run build`.

`npm start` starts the local server at `http://localhost:8200` and opens the reader in your browser. To run without opening a browser, use `npm start -- serve --no-open`.

The CLI is currently installed from this repository; a release is **not yet available from the npm registry**. These source installation commands include the current reader and Kindle companion and do not install Electron or desktop build tooling.

From the checkout, run CLI commands with `npm start --`, for example:

```bash
npm start -- project list
```

To use the shorter `pdfpal` command shown in the CLI and agent examples below, optionally link it from the checkout:

```bash
npm link
pdfpal --help
```

Keep the checkout in place when using this link. AI features use your assistant’s existing authentication and provider allowance.

## Quickstart

### Read a PDF

1. Click **New Project** and give it a title.
2. Click **Add Source** and search by title, paste a paper URL (arXiv, OpenReview, ACL Anthology, PMLR, a DOI link, or a direct `.pdf`), or choose **Upload PDF** to import a local file up to 25 MB.
3. Open the source, select the passage you're stuck on to ask about it, or save it as a highlight.
4. Switch to the **Notes** tab and write what you understood in your own words as a markdown note; it renders as you read it back.
5. Ask a question across every source in the project from **Project Chat**.

Use **Dark pages** beside the reader's zoom controls for a dark page background and light text. The setting is remembered in your browser across documents and reloads. It also changes figure and photo colors; switch it off to view their original colors.

Double-click an English word for a local definition, or select a short phrase. **Definitions** toggles the bundled offline dictionary; it needs no AI account. See the [reader guide](docs/reader-guide.md) for definitions, selection context and navigation.

After following a reference link within a PDF, click **Back to citation** in the reader toolbar to return to your previous position and zoom. Follow several references and click it repeatedly to retrace your jumps.

### Read a Kindle book

1. Start pdfpal. In the Windows or Linux desktop app, choose **pdfpal menu → Kindle extension**. In the browser reader, choose **Extension** on the projects home page (or **Kindle extension** in a project).
2. **Download Chrome extension**, extract it to a folder you will keep, and open `chrome://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. Pin pdfpal to Chrome's toolbar. Open your book in [Kindle for Web](https://read.amazon.com/), refresh the tab, and click the pdfpal toolbar icon.
4. Click **Connect to pdfpal**. In the local tab that opens, click **Allow connection**, then return to Kindle. Choose or create a project.
5. Ask a book question, select a passage to attach it, or type `/visual <concept>`. Save useful passages and answers as project notes.

No pairing code is needed for this flow. Keep pdfpal running; if it stops, restart it and Retry. **Address & manual pairing** supports custom ports and the older code-based connection flow. The web **Extension** page also lets you name and disconnect paired connections.

Supported readers: `read.amazon.com`, `ler.amazon.com.br`, and `read.amazon.co.uk`, in desktop Chrome. English prose is the initial OCR target. This companion works with Kindle for Web, not the native Kindle PC application. See the [companion guide](extension/README.md) for capture, update, and troubleshooting instructions.

## Features

### Kindle reading

The [Kindle Companion](extension/README.md) brings the same dark chat pane to Kindle for Web. Ask about the open book, attach native selections or locally recognized image text, generate visual explanations with `/visual`, and save passages or answers as project notes. Conversations survive closing the panel and normal extension updates.

Keep books in a project with **Add Source → Kindle book**, or use **Book details → Add book to project** in the companion. **Open in Kindle ↗** launches the reader in a new tab and selects the associated project in the connected companion. These entries store book references; full Kindle text is not imported or indexed.

Book questions use title/author, previous discussion, and captured or saved excerpts. The full Kindle book is not imported. Relevant project PDFs can be included explicitly; a project does not need PDFs to support Kindle chat.

### Reading & Chat

- **Split-pane reader**: PDF viewer on the left, chat/notes/related on the right; resizable.
- **Reading progress**: remembers the last page read for every source and restores it automatically the next time you open the PDF.
- **Per-source chat**: persistent conversation history per paper, restored across sessions; renders math (KaTeX). Answers use retrieved local text and the assistant’s background knowledge. Reading calls run with shell and web tools disabled; paper discovery is available separately.
- **Text selection → ask or highlight**: stuck on a passage? Select it and ask about it right there, grounded in the paper, or save it as a highlight.
- **Offline dictionary**: double-click a word, or select a short phrase, and its meanings appear under it. Inflected forms (“ran”, “mice”), hyphenated words and compounds (“neural network”) are recognised. It is English only, uses the bundled WordNet 3.1 data, and sends nothing anywhere. Turn it off with **Definitions** in the reader toolbar.
- **Project chat**: ask across multiple sources at once, toggle which sources are in context, or scope to a single collection.

### Visual explanations

Select text in the PDF reader and choose **Explain visually** from its popup, or type `/visual <concept>` in the reader or project chat. Type `/` for a command suggestion; Tab completes `/visual`. With a passage attached, `/visual` alone explains that selection. The same command works in the [Kindle companion](extension/README.md#explain-visually). Your configured assistant supplies content for flow diagrams, plots, token/vector grids, comparisons, bars and quadrants; pdfpal handles their layout. Figures reveal in steps with named clickable details, captions, source labels and a full text transcript. Use Next/Back, the segmented progress bar or arrow keys; **Expand** keeps your current step in a larger viewer. Save to a project note or export a self-contained HTML file that uses the same renderer and works offline. Saved explanations reopen without another model call, including older saved visuals. Project chat also supports general-concept questions without PDFs. See the [visual explanation guide](docs/visual-explanations.md).

### Share what you read

Turn something from a PDF into a post for **LinkedIn**, **X · Bluesky · Threads** or **Instagram**: an image made from the paper's own page, and a draft text. Your configured assistant writes the words in a single request while you keep reading. The image is drawn on your computer, and posts stay on this device.

- **From a highlight**: click a highlight and choose **Create post**. The image is the page cropped around your highlights, each in its own colour.
- **From a region**: **Share a region** in the **Post** tab takes a figure, a table, an equation or a passage.
- **The whole paper**: **Share the paper** writes what the paper set out to answer, how it was done and what it found.
- **Several highlights**: **Share several highlights** makes a carousel with one slide per highlight.
- **Your take**: type one line of what you think and choose **Rewrite around my take**. Every draft quotes it word for word.
- **Carousels and numbers**: on Instagram a post opens as a carousel. Slides show a key number, a study's design or a small comparison table as numbers, and every number comes from the text.
- **Export**: copy or save an image. A carousel also saves as a ZIP of PNG files or as one PDF.

See the [sharing guide](docs/share-posts.md) for destinations, styles and looks, cropping, drafts and editing.

### Organization

- **Projects**: workspaces for a research topic: sources, notes, chat history.
- **Collections**: nested folders for organizing sources within a project; drag-and-drop, Expand/Collapse All.
- **Notes**: markdown notes at the project or source level, rendered by default, edit in place.
- **Highlights**: every annotation across a project, grouped by source, one click back to context, with **Create post** or **Open post** on each one.

### Backups, recovery & privacy

Open **pdfpal menu → Backups & recovery** in the Windows or Linux desktop app, or **Backups** at the lower left in the browser reader. Save a complete local library copy, including managed PDFs, notes, highlights, saved conversations and visual explanations. Automatic backups run daily by default while the app is open; choose every six hours, daily or weekly. Verify a backup or open a separate recovery copy while keeping your current library. **Recently deleted** retains up to 100 deletion entries for 30 days. See [backup and recovery](docs/backup-recovery.md).

**Privacy & diagnostics** in the desktop app menu (or **Privacy** in the browser) separates local diagnostics, optional usage analytics and default-off error sharing. Shared error reports exclude documents, conversations, titles, filenames and raw error messages. See [error reporting](docs/error-reports.md).

### Sources & Discovery

- **Paper search**: search OpenAlex by title, one click to add.
- **Related papers**: references and citations from Semantic Scholar, with an OpenAlex fallback when needed, one click to add.
- **Smart PDF resolver**: paste any URL: arXiv, OpenReview, ACL Anthology, PMLR, a DOI link, or a direct `.pdf`; tracking params stripped automatically.
- **Project-wide full-text search**: SQLite FTS5 across every already-indexed source.
- **Managed local copies**: PDFs are copied locally; falls back to the source URL if a managed copy is deleted.

### CLI & Agent Automation

- **CLI**: manage projects, sources, collections and notes, list highlights, search indexed text, and ask questions with `pdfpal`; use `--json` for scripting.
- **ChatGPT / Claude Code / Codex skill**: let an agent drive projects, sources, collections, and notes directly (see below).

## Research with an agent, then read

Finding papers is legwork, and by now agents are better at it than we are: they sweep the literature, follow citation trails, and triage abstracts faster than anyone with twelve tabs open. Reading is the part that's still yours. So pdfpal splits the job: give an agent a topic and it searches on its own, drives the pdfpal CLI through the [Agent skill](#agent-skill), and hands you back a project with the papers already fetched, filed into collections, and ready to read.

1. **Ask an agent** (Claude Code, Codex, or anything that can load the skill):

   > Research recent approaches to efficient attention mechanisms, create a pdfpal project called "Efficient Attention", and add the best papers you find.

2. **The agent finds the papers with its own tools**, then drives the real CLI to build the project. For example:

   ```bash
   pdfpal --json project create "Efficient Attention"
   pdfpal --json source add <project-id> "https://arxiv.org/abs/1706.03762"
   pdfpal --json source add <project-id> "https://arxiv.org/abs/2009.06732"
   pdfpal --json collection create <project-id> "Core Papers"
   pdfpal --json source file <project-id> <source-id> <collection-id>
   ```

3. **Open it in the browser**, already organized into collections.

4. **Read and ask questions inline**, in the reader shown in the video above, right where the agent left off.

## CLI

The examples below use the optional `pdfpal` command from the [source setup](#linux-and-wsl). Without `npm link`, run them from the checkout with `npm start --` in place of `pdfpal`.

```bash
pdfpal project create "My Research"
pdfpal source add "My Research" https://arxiv.org/abs/1706.03762
pdfpal collection create "My Research" "Core Papers"
pdfpal source list "My Research"
pdfpal note create "My Research" -t "Summary" -c "Key findings..."
pdfpal ask "My Research" "Compare the main methods"
```

Commands accept a UUID or an exact case-insensitive title. Ambiguous titles are rejected. Add `--json` for machine-readable output. `pdfpal ask <project>` reads the question from stdin when the question argument is omitted.

## Agent skill

`skills/pdfpal-cli/` documents the full CLI (flags, exit codes, selector rules) so an agent can drive it directly; see [Research with an agent, then read](#research-with-an-agent-then-read) above for what that looks like in practice. It does not search for papers itself; that's the agent's job, using its own tools.

For the Windows ChatGPT app, use [Command line & ChatGPT setup](#windows-desktop-preview) and verify **Pdfpal CLI** appears under **Skills → Installed**. A local skill requires a session with local execution access; installing it does not connect a browser-only chat to your PC. If the app uses WSL, follow the [distribution-specific setup](docs/windows-cli.md).

For the Linux/WSL source setup, install it for Claude Code and Codex using the existing source installer (symlinks into `~/.claude/skills/` and `~/.codex/skills/`):

```bash
npm run skill:install
```

Run `npm run skill:uninstall` to remove the symlinks.

## Optional cloud library

Open **Cloud library** from the Windows toolbar, Linux app menu or browser reader and sign in with Google. Sign-in alone uploads no library content. Explicitly enable sync to share projects, source metadata, nested collections, notes, highlights and reading progress. Choose **Include saved conversations** separately to synchronize existing and future saved PDF and project questions and answers. AI-provider sign-in is separate from Google sign-in.

SQLite remains the working library, with changes queued while offline. Each Google account has one account library; another device joins it from an empty local library. If an older version created multiple cloud libraries, choose the complete one explicitly with **Use as account library**. A device bound to another legacy library stops before uploading; **Restore account library separately** backs up its local work and restores the account library into a separate library. This keeps the original available and does not merge the two. **PDF files, Kindle extension history and interactive visual assets stay local in the bundled configuration.** PDF file transfers require a separately configured, billing-enabled Cloud Storage bucket and explicit opt-in on each device. Keep full local backups. See [cloud setup and supported data](docs/firebase-setup.md).

## Local data

Linux/WSL uses `~/.pdfpal` by default; the Windows app uses `%USERPROFILE%\.pdfpal`. Both store the same kinds of local data:

```text
~/.pdfpal/
├── config.json
├── pdfpal.db
├── files/       # managed PDF copies
└── backups/     # pre-migration snapshots and full library backups
    └── libraries/  # default location for complete library copies
```

New PDFs are copied into `files/`, while extracted text and FTS chunks live in SQLite. If a managed PDF is removed and the source has a URL, the reader downloads and renders the remote PDF without recreating the copy.

Existing databases are migrated in place after an automatic backup. Override the data directory with `PDFPAL_DATA_DIR` or only the database path with `PDFPAL_DB`.

Windows and WSL use separate default libraries. Sharing a live SQLite library between them is not a supported preview workflow. Windows upgrades and uninstall retain your library.

## Configuration

Configuration precedence is command flags, environment variables, `config.json` in your library folder, then defaults. The default file is `~/.pdfpal/config.json` on Linux/WSL and `%USERPROFILE%\.pdfpal\config.json` on Windows.

```bash
PDFPAL_AGENT=claude       # claude | codex | opencode
CLAUDE_BIN=claude
CODEX_BIN=codex
OPENCODE_BIN=opencode
PDFPAL_MODEL=
PDFPAL_PORT=8200
PDFPAL_DB=
PDFPAL_DATA_DIR=
SEMANTIC_SCHOLAR_API_KEY=
```

`SEMANTIC_SCHOLAR_API_KEY` is optional. Semantic Scholar's unauthenticated API shares a small rate limit across every caller on your network, not just you. A [free key](https://www.semanticscholar.org/product/api#api-key-form) is scoped to your own app instead and raises the limit substantially. Used for Related Papers and clean titles for arXiv/DOI links.

Legacy `~/.pdfpal/config.env` is imported automatically on first TypeScript startup.

## Development and tests

```bash
npm run typecheck
npm test
npm run build
npm exec --workspace frontend -- playwright install --with-deps chromium
npm exec --workspace extension -- playwright install --with-deps chromium
npm exec --workspace frontend -- playwright test
npm --prefix desktop test
npm run test:extension
npm run test:archive
npm run test:package
```

`npm run build:server` (run by `npm run build` and before `npm test`) also builds the offline dictionary, `dist/dictionary/wordnet.sqlite`, from the `wordnet-db` dev dependency and the irregular-form lists in `data/wordnet/`; it is skipped when up to date.

`npm run build` builds the server, web reader, and extension, and creates a reproducible ZIP in `extension/package/`. The server serves that matching ZIP from its Extension page. `test:package` installs a real tarball into a temporary prefix and exercises guided pairing, chat, and note saving outside the checkout. Extension browser tests use their workspace’s bundled Chromium; all automated AI calls use fixtures.

`npm test` runs Node's test runner through `tsx`, fails when no tests are found, and enforces the configured c8 coverage thresholds. Playwright starts the compiled Fastify server using an isolated temporary data directory. Set `PLAYWRIGHT_EXECUTABLE_PATH` to use a system Chromium installation.

Documentation-only CI runs link checks, credential scanning and tests of the change classifier. Application builds, browser suites, Firebase contracts and native packaging are skipped when the entire change is limited to documentation/media. Code, tooling, workflows, dependency inputs and shipped agent skills keep full validation; manual Windows checks always run.

## Architecture

The Windows desktop app, Linux desktop engineering preview, web reader, Kindle companion, and CLI share TypeScript services, local storage, and AI configuration. The desktop app hosts the reader and its local backend in Electron. Windows closes to its tray; Linux closes by quitting safely. The web reader uses the same-origin Fastify API; the extension uses a loopback bridge with revocable credentials. The standalone CLI calls services directly; the bundled Windows CLI connects to the running app through a private pipe, and `pdfpal-desktop-cli` on Linux uses authenticated loopback HTTP. Kindle conversations are scoped to connection, project, and book, separately from PDF chat sessions. Saved notes are available in the project UI.

```text
Web reader ── HTTP ──▶ Fastify API ──┐
Kindle companion ────▶ Local bridge ─┤
                                    ├── TypeScript services
pdfpal CLI ─────────────────────────┘       │
                                            ├── SQLite, retrieval, notes, history
                                            ├── Managed PDF copies and extracted text
                                            ├── ChatGPT (desktop) / Claude / Codex / OpenCode
                                            └── OpenAlex / Semantic Scholar
```

### Main data paths

- **Ingest**: `SourceService` resolves a local file or URL, extracts its text, stores a managed PDF copy, and chunks/indexes the text in SQLite FTS5.
- **Ask**: `ChatService` scopes retrieval by project, source, or collection, builds a grounded prompt from matching passages, invokes the configured AI provider, and persists the answer and source references.
- **Use**: React pages call the Fastify API; CLI commands and [`skills/pdfpal-cli`](skills/pdfpal-cli/) automate the same core operations. Reading subprocesses run with tools disabled. Paper discovery uses the separate OpenAlex and Semantic Scholar services; an external research agent can use its own tools before importing papers.

The implementation follows that split:

- [`desktop/`](desktop/) contains the optional desktop shell, Windows/Linux packaging tooling, and platform acceptance checks. See the [desktop build guide](desktop/README.md) and [automatic release pipeline](docs/windows-release-pipeline.md).
- [`extension/`](extension/) contains the Chrome side panel, reader capture, bundled OCR, and guided connection flow.
- [`frontend/src`](frontend/src/) contains the reader, chat, projects, notes, collections, and source-discovery UI.
- [`src/server`](src/server/) exposes the HTTP API and serves the built frontend.
- [`src/cli`](src/cli/) defines the scriptable `pdfpal` commands.
- [`src/core`](src/core/) owns projects, sources, collections, notes, retrieval, chat, PDF handling, configuration, and agent invocation.

The source package build contains the compiled TypeScript server/CLI, built React frontend, unpacked Chrome extension, and matching ZIP with bundled OCR assets. The [library folder](#local-data) holds the working data. Network access supports source downloads, paper discovery, the configured AI provider and, when enabled, Firebase cloud sync and telemetry. The Windows shell also handles account sign-in and explicit update checks. The local server is intended for single-user operation.

*AI to read deeper, not to avoid reading.*
