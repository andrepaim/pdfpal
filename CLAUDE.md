# pdfpal developer guide

## Stack

- Node.js 22+, TypeScript, ESM
- Fastify local HTTP server
- React + Vite frontend
- SQLite via `better-sqlite3`, WAL, foreign keys, FTS5
- `pdfjs-dist` PDF extraction
- Commander CLI
- Claude, Codex, and OpenCode subprocess adapters

## Structure

- `src/core/` — configuration, migrations, services, PDF handling, retrieval, research APIs, and agents.
- `src/server/` — Fastify routes and static SPA serving.
- `src/cli/` — installable `pdfpal` command.
- `frontend/` — React SPA and Playwright tests.
- `test/` — Node unit/integration tests and fixtures.
- `scripts/run-tests.mjs` — deterministic test discovery that fails on zero tests.

## Commands

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
cd frontend && npx playwright test
```

Use `npm run dev` to run the TypeScript server through `tsx`. Running `pdfpal` without arguments is equivalent to `pdfpal serve`.

## Data and migrations

Local state defaults to `~/.pdfpal`. `pdfpal.db` stores projects, sources, extracted text, chat, notes, annotations, related-paper cache, and FTS chunks. Managed PDFs live under `files/`. Schema migrations run during database open and create a backup before changing an older database. Legacy `sessions/messages` data is migrated into projects, sources, and chat sessions.

Never use the real home database in tests. Use the temporary configuration helpers under `test/helpers`.

## Product constraints

- Local, single-user application; no OAuth or public-server mode.
- Browser and CLI must call the same core services.
- New PDF sources are stored locally, but rendering falls back to the source URL when the managed copy is missing.
- Project questions use SQLite FTS5 retrieval rather than embedding APIs.
- External APIs and agent binaries must be mocked in automated tests.

## Publishing

The npm package publishes `dist/` and `frontend/dist/`. Always run typecheck, tests, build, Playwright, and `npm pack --dry-run` before publishing.
