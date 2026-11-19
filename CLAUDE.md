# pdfpal developer guide

pdfpal is a local-first reading assistant for PDFs and Kindle books. It has four surfaces that share one TypeScript core: the Windows desktop app and Linux desktop engineering preview, the browser reader, the `pdfpal` CLI, and the Chrome Kindle companion.

## Stack

- Node.js 22+, TypeScript, ESM; root npm workspaces `frontend` and `extension`
- Fastify local HTTP server; React + Vite frontend
- SQLite via `better-sqlite3`, WAL, foreign keys, FTS5
- `pdfjs-dist` PDF extraction; Commander CLI
- AI: Claude Code, Codex, and OpenCode subprocess adapters, plus direct ChatGPT in the desktop app (Linux persistence requires a supported OS keyring)
- Electron 45 and electron-builder in `desktop/`, which has its own `package.json` and lockfiles and is not a root workspace
- Firebase Auth, Firestore, and optional Cloud Storage, called from the local backend with the signed-in user's credentials (no service account)

## Structure

- `src/core/`: config, migrations (`database.ts`), services (projects, sources, collections, notes, highlights, chat, trash, backups), PDF handling, FTS retrieval, research APIs, Kindle, visual explanations, share posts (`share-cards.ts`), the offline dictionary (`dictionary.ts`; `dictionary-build.ts` runs at build time) and its opt-in contextual order (`contextual-definitions.ts`, `sense-order.ts`, `sense-model.ts`, worker `sense-worker.ts`; see `docs/contextual-definitions.md`), telemetry, error reports, agent adapters (`agents.ts`, `agent-discovery.ts`, `ai.ts`). `chatgpt/` holds the ChatGPT sign-in and Responses protocol.
- `src/server/`: Fastify routes and SPA serving, the extension bridge (`extension*.ts`), cloud routes (`cloud.ts`), recovery, and the private pipe used by the Windows CLI (`cli-pipe.ts`).
- `src/sync/`: Firebase cloud sync: auth, the SQLite outbox (`database.ts`), the Firestore transport, and the worker.
- `src/shared/`: code shared across server, frontend, extension, and desktop: sync record schema (`sync/schema.ts`), diagnostics allowlist, CLI protocol, extension pairing, public Firebase identifiers, the share-card contract (`share-card.ts`; its zod schemas are in the server-only `share-card-schema.ts`, so zod stays out of browser bundles).
- `src/cli/`: the `pdfpal` command. `standalone.ts` calls core services directly. `desktop.ts` talks to a running desktop app over a Windows private pipe or Linux authenticated loopback HTTP. It is selected by `--desktop`, `--profile`, `PDFPAL_CLI_DESKTOP=1`, or the `status`, `doctor`, `library`, `skill`, and `operation` commands. `dictionary` commands run locally even with `PDFPAL_CLI_DESKTOP=1`, unless `--desktop` or `--profile` is given.
- `frontend/`: React SPA (the desktop app hosts the same SPA) and Playwright tests in `frontend/e2e/`. Share posts: the Post panel is `frontend/src/components/SharePostPanel.tsx` (destination, image, take, text, export; small parts in `SharePostParts.tsx`, the crop editor in `CropEditor.tsx`), its client calls are in `frontend/src/lib/share-card-api.ts`, and cards are drawn locally by `frontend/src/lib/share-card/` (pure `layout.ts`, canvas `draw.ts`, the page crop with every highlight through pdf.js in `crop-box.ts` and `page-crop.ts`, crop editing geometry in `crop-edit.ts`) with the bundled Inter and Newsreader fonts in `frontend/public/fonts/`; the hidden `/dev/share-cards` page draws the sample matrix and the Page and Headline frames, and `/dev/crop-editor` hosts the crop editor alone. `vite.auth.config.ts` builds the hosted Google sign-in page from `cloud/auth/` into `cloud/hosting/`.
- `extension/`: Chrome MV3 side panel for Kindle for Web: page capture, bundled OCR, pairing with the local server. Its build writes `extension/dist/` and a reproducible ZIP to `extension/package/`, which the server offers for download.
- `desktop/`: Electron shell (main process, sandboxed renderer, backend utility process, ChatGPT session and vault), installer and release scripts, Windows acceptance drivers (`desktop/scripts/windows-m*.ps1`), Node tests in `desktop/test/`.
- `cloud/`: Firebase config: `firestore.rules`, `storage.rules`, indexes, hosted sign-in page.
- `skills/pdfpal-cli/`: agent skill, shipped in the npm package and desktop packages.
- `test/`: Node unit/integration tests and fixtures. `test/helpers/test-utils.ts` creates temporary configs and databases.
- `scripts/`: `run-tests.mjs` (fails on zero tests), `test-package.mjs`, `test-extension-archive.mjs`, `check-secrets.mjs`, skill installers.
- `docs/`: [indexed current guides](docs/README.md), plans, milestone results, and runbooks (`windows-desktop-plan.md`, `windows-release-pipeline.md`, `firebase-setup.md`, `backup-recovery.md`, `error-reports.md`).

## Commands

```bash
npm ci
npm run typecheck
npm run check:docs        # tracked Markdown paths and local heading links
node --test scripts/ci-changes.test.mjs # CI path selection with real temporary Git histories
npm test                  # builds the server, runs test/**/*.test.ts, enforces c8 coverage thresholds
npm run build             # server, frontend, extension and its ZIP
npm run dev               # tsx server without opening a browser
npm start                 # compiled server (run build first)
npm exec --workspace frontend -- playwright test   # needs npm run build first
npm run test:extension    # builds, then runs extension Playwright tests
npm run test:archive      # verifies the extension ZIP
npm run test:package      # installs the packed tarball in a temp prefix and exercises it
npm --prefix desktop test # desktop Node tests (no Electron install needed)
npm run test:firebase     # Firestore/Storage rules on emulators; needs the firebase CLI
node scripts/check-secrets.mjs
npm run eval:retrieval    # offline retrieval scores; run `npm run eval:retrieval:fetch` once first (downloads the test papers)
```

Install Playwright browsers with `npm exec --workspace <frontend|extension> -- playwright install --with-deps chromium`. CI runs the Firebase emulators with `npm exec --package=firebase-tools@15.5.1`. The rules tests are skipped in `npm test` when no emulator is running. Windows packaging runs on Windows (`node desktop/scripts/stage.mjs`, then `desktop/scripts/windows-m3.ps1`). Linux packaging uses `npm --prefix desktop run package:linux` after staging; see `desktop/README.md` and `docs/linux-quickstart.md`. Running `pdfpal` without arguments is equivalent to `pdfpal serve`. The default address is `127.0.0.1:8200`.

## Data and migrations

- The library defaults to `~/.pdfpal` (Windows app: `%USERPROFILE%\.pdfpal`). Override it with `PDFPAL_DATA_DIR`, or only the database with `PDFPAL_DB`. `pdfpal.db` holds the library, extracted text and FTS chunks, chat, notes, annotations, share posts (local only, never synced), Kindle history, trash, AI jobs, sync outbox, and diagnostic queues. Managed PDFs live in `files/`, backups in `backups/`.
- Schema version is `CURRENT_SCHEMA` in `src/core/database.ts`, checked against `MAX(version)` in `schema_migrations`. `migrate()` runs on every open in one immediate transaction. Some steps live in other modules (`installTrash`, `installErrorReports`, `installSync`, `installCliOperations`). New steps must be idempotent and insert their version row.
- Bump `CURRENT_SCHEMA` with each new version. It gates the `VACUUM INTO` backup taken before migrating an older database, and the `NEWER_DATABASE` refusal for databases from a newer build. Startup is serialized by a lease in `locking.ts`. Migration tests are in `test/integration/database-migration.test.ts`.
- Legacy `sessions/messages` data is migrated into projects, sources, and chat sessions.
- Rendering falls back to the source URL when the managed PDF copy is missing.
- The reader's dictionary is a separate read-only file, `dist/dictionary/wordnet.sqlite`, built by `npm run build:server` from the `wordnet-db` dev dependency and `data/wordnet/*.exc`. It is not part of the library: no migration, sync or backup. It is opened from memory because the desktop app keeps it inside the app archive. It is named `.sqlite` because `test:package` rejects `.db` files in the tarball.
- Contextual definition order (off by default; reader toolbar **Order by context**, saved per library in `config.json`) uses a pinned Ettin INT8 model and ONNX Runtime. Files come from `<library>/models/` or `sense_*` overrides (CLI `pdfpal dictionary install-model`/`install-runtime`, local only), else from the per-user cache (`senseCacheDir`, `v1/model|runtime/...`, immutable, lock in `v1/.locks/`). The reader fills that cache by a confirmed one-time download of the release bundles named in `src/core/sense-download-assets.ts` (`sense-download.ts`, streaming ZIP reader `zip-extract.ts`, service `contextual-service.ts`). Every file is verified by SHA-256 before use. The only network request is the confirmed `POST /api/dictionary/contextual/download`. State changes need same-origin JSON; lookups fail open to WordNet order. Tests set `senseCacheDir` to a temporary directory. `onnxruntime-node` and `@huggingface/tokenizers` are optional peer dependencies and root dev dependencies; `.npmrc` skips ONNX Runtime's CUDA download. Regenerate `src/core/sense-runtime-manifest.ts` with `node scripts/sense-runtime-manifest.mjs` after changing their versions. Tests use a fake worker; the real-model test runs only with `PDFPAL_TEST_SENSE_MODEL_DIR`. Source runs use the compiled worker in `dist/`.
- Synced record shapes are defined twice: `src/shared/sync/schema.ts` and the exact key lists in `cloud/firestore.rules`. Change both, then run `npm run test:firebase`.
- Windows and WSL use separate libraries. Sharing one live SQLite file between them is unsupported.

## Product constraints

- Local-first and single user. The SQLite library is the working copy, and using the app needs no account.
- Optional sign-ins: Google (Firebase) for cloud sync, and "Continue with ChatGPT" in the desktop app (Linux requires secure keyring storage). Sign-in alone uploads nothing. Sync, saved conversations, and PDF transfers are separate opt-ins.
- No public-server mode. The server binds `127.0.0.1` and rejects non-loopback Host headers and cross-origin API calls. The extension uses `/api/extension/`, which requires a paired, revocable token.
- Browser, desktop, extension, and CLI call the same core services.
- Project questions use SQLite FTS5 retrieval, not embedding APIs.
- PDF and page text is untrusted, so assistants run with tools disabled (`AgentService.run` in `src/core/agents.ts`). Each runs in a temporary cwd. Claude runs with `--tools ''` and MCP disabled. Codex runs with a read-only sandbox, shell and web search disabled, ephemeral, ignoring user config. OpenCode uses an agent with no permissions. ChatGPT requests send no tools. Do not loosen these.
- Telemetry and error reporting are opt-in (default off) and content-free. Events and reports carry only allowlisted codes, versions, platform, and timings (`src/core/telemetry.ts`, `src/shared/diagnostics.ts`), and the Firestore rules reject extra fields. Never add titles, paths, URLs, prompts, answers, or error text.
- External APIs, Firebase, ChatGPT, and agent binaries must be mocked in automated tests.
- Never use the real home database in tests. Use `testConfig()` from `test/helpers/test-utils.ts`. Playwright starts the server with a temporary `PDFPAL_DATA_DIR`.

## Publishing

- npm: the package publishes `dist/`, `frontend/dist/`, `extension/dist/`, `extension/package/`, `skills/`, and the skill install scripts. Publishing is manual. First run typecheck, `npm test`, build, frontend and extension Playwright, `test:archive`, `test:package`, and `npm pack --dry-run`.
- Windows: a version change in `desktop/version.json` pushed to `master` triggers `.github/workflows/windows-release.yml`. The workflow runs Linux regression and Windows installer acceptance, then publishes a GitHub release `desktop-v<version>`. Versions must increase. Suffixed versions (`-preview.N`) ship as unsigned prereleases, and stable versions require signing secrets. Do not edit that file unless you intend to release. See `docs/windows-release-pipeline.md`.
- Linux: `ci.yml` builds the x86-64 Debian engineering preview, validates the sandbox/keyring/CLI with isolated data, and uploads `pdfpal-linux-x64-preview`. It is not published by the Windows release workflow. Live account flows and interactive desktop acceptance remain separate gates.
- The desktop and npm versions are independent: changing `package.json` publishes nothing.
- `ci.yml` runs on pushes to `master` and on PRs. A reusable change-scope job always tests its classifier. Documentation links and credential checks always run. Changes limited to root Markdown, platform READMEs, and documentation/screenshots media skip application suites. Code, tooling, workflows, dependency inputs, shipped skills, unknown paths and unavailable comparisons run the full suite: typecheck, desktop tests, `npm test`, build, frontend/extension Playwright, archive/package checks, Firebase emulator contracts and Linux packaged acceptance. The Windows installer workflow uses the same gate; manual runs always build. See `scripts/ci-changes.mjs` for the exact allowlist.

## Current focus

Use `docs/README.md` for the maintained guide map. Merged reader work includes page-aware retrieval, the second-generation visual renderer, offline WordNet definitions, share posts (`docs/share-posts-plan.md`), a Linux Debian desktop preview and one cloud library per Google account. `docs/reader-beta-and-retrieval-plan.md` records the beta/retrieval work and outstanding manual gates; it is not a blanket ban on the features already merged. Mac desktop, Android and multi-format source plans are outside the current default-branch feature set.
