# pdfpal

Read, organize, and ask questions about research papers from a local web app or an installable CLI. pdfpal is written in TypeScript, stores its data locally, and uses an installed Claude, Codex, or OpenCode CLI for AI answers.

## Features

- Project workspaces with PDF sources, notes, artifacts, annotations, and chat history.
- PDF reader with inline highlights, source chat, and related papers.
- Project-wide questions using SQLite FTS5 retrieval across selected sources.
- Paper search through OpenAlex and related references/citations through Semantic Scholar.
- Managed local PDF copies with URL fallback if a copy is deleted.
- Scriptable CLI with human-readable output and `--json` support.

## Requirements

- Node.js 22 or newer.
- One supported agent CLI installed and authenticated: `claude`, `codex`, or `opencode`.
- Optional Tavily API key for web-augmented chat.

## Install and run

```bash
npm install -g pdfpal
pdfpal
```

Running `pdfpal` starts the local Fastify server at `http://localhost:8200` and opens the browser. Use `pdfpal serve --no-open` to suppress the browser.

For development:

```bash
npm ci
npm run build
npm start
```

## CLI

```bash
pdfpal project list
pdfpal project create "My Research"
pdfpal source add "My Research" https://arxiv.org/abs/1706.03762
pdfpal source list "My Research"
pdfpal source move "My Research" "Paper title" "Another Project"
pdfpal source reindex "My Research"
pdfpal ask "My Research" "Compare the main methods"
pdfpal papers search "attention mechanisms"
```

Commands accept a UUID or an exact case-insensitive title. Ambiguous titles are rejected. Add `--json` for machine-readable output. `pdfpal ask <project>` reads the question from stdin when the question argument is omitted.

## Local data

pdfpal uses `~/.pdfpal` by default:

```text
~/.pdfpal/
├── config.json
├── pdfpal.db
├── files/       # managed PDF copies
└── backups/     # automatic pre-migration database backups
```

New PDFs are copied into `files/`, while extracted text and FTS chunks live in SQLite. If a managed PDF is removed and the source has a URL, the reader downloads and renders the remote PDF without recreating the copy.

Existing databases are migrated in place after an automatic backup. Override the data directory with `PDFPAL_DATA_DIR` or only the database path with `PDFPAL_DB`.

## Configuration

Configuration precedence is command flags, environment variables, `~/.pdfpal/config.json`, then defaults.

```bash
PDFPAL_AGENT=claude       # claude | codex | opencode
CLAUDE_BIN=claude
CODEX_BIN=codex
OPENCODE_BIN=opencode
PDFPAL_MODEL=
PDFPAL_PORT=8200
PDFPAL_DB=
TAVILY_API_KEY=
```

Legacy `~/.pdfpal/config.env` is imported automatically on first TypeScript startup.

## Development and tests

```bash
npm run typecheck
npm test
npm run build
cd frontend && npx playwright test
```

`npm test` runs Node's test runner through `tsx`, fails when no tests are found, and enforces the configured c8 coverage thresholds. Playwright starts the compiled Fastify server using an isolated temporary data directory. Set `PLAYWRIGHT_EXECUTABLE_PATH` to use a system Chromium installation.

## Architecture

```text
CLI ───────┐
           ├── TypeScript core ── SQLite + FTS5 + managed PDFs
Fastify ───┘          │
   │                  ├── Claude / Codex / OpenCode CLI
   └── React SPA      ├── OpenAlex / Semantic Scholar
                      └── Tavily (optional)
```

The npm package contains the compiled TypeScript server/CLI and the built React frontend and is intended for local, single-user operation.
