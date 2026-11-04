# Firebase desktop sync alpha verification

Date: 2026-11-04. This receipt describes local/emulator acceptance and project registration. It does not claim production cloud activation or completion of the broader sync roadmap.

## Implementation

- Local SQLite schema 12: transactional outbox, account/library/generation binding, optimistic revisions, separate acknowledged remote state, cursor, preserved conflicts, PDF transfer markers and bounded diagnostic journal.
- Direct Firebase REST transport: user credentials, Firestore transactions, immutable receipts/change feed, bounded contention retries, private immutable PDF transfers. A separate Fastify/Cloud Run service is no longer part of the deployment.
- Google OAuth desktop flow: system browser, state and PKCE, Firebase credential exchange, token refresh, Electron protected credential bridge; standalone server credentials remain in memory.
- Local settings and CLI: sign-in/out, explicit cloud binding, pause/resume, sync/status, metadata-only disclosure, note conflict review/resolution, separate default-off diagnostic and analytics consent.
- Renderer Firebase Analytics/Performance adapters, content-free event journal, consent/redaction and error containment.
- Rules/index configuration and CI emulator job.

## Accepted verification

- `npm test`: 130 reported tests, 129 passed, one Firestore integration test skipped because this ordinary run has no emulator. Zero failures. Coverage check passed.
- `npm run typecheck`: passed.
- `npm run build --workspace frontend`: passed; existing large-bundle warning remains.
- Firestore + Storage emulators, Node 22 / Java 21, demo project `demo-pdfpal-sync`: eight reported tests passed with zero skips/failures. This uses the production REST transport and rules. Cases cover idempotent commits, concurrent sequence allocation, cross-account access, partial-write/history rejection, stale revisions, private immutable PDF access, and two SQLite libraries restoring the same verified PDF and note.
- Focused auth/outbox/telemetry tests: four passed. A token refresh completing after logout cannot restore the prior session.
- Focused CLI/auth/migration tests: fourteen passed.
- Chromium `frontend/e2e/cloud-settings.spec.ts`: two passed. Consent persists, unconfigured renderer emits no Firebase telemetry requests, and metadata-only scope is shown.
- Desktop credential-vault regression: passed. Desktop main/backend syntax checks passed; signed Windows/live credential persistence was not run.
- `git diff --check`: passed.

The initial Storage test exposed overwrite permission through a create request; the rule now explicitly requires `resource == null`, and the retained regression passes. The initial consent browser test exposed a delayed controlled-checkbox update; optimistic UI with a disabled save state now passes persistence/revocation checks.

## External state

Created project `pdfpal-cloud-20261104` and registered Firebase web app `1:834297766058:web:3968a4200a873ffa2230d3` (pdfpal desktop). Public SDK configuration was downloaded to a temporary local file. No billing account was attached; no production Firestore region/database, rules, bucket, telemetry or personal content was deployed by this work.

## Outstanding release gates

Google provider/Desktop OAuth setup and live login/refresh; signed Windows vault/upgrade acceptance; actual Analytics/Performance ingestion and automatic-data redaction; Firebase location and free-tier capacity measurements; optional billing-dependent PDF storage activation. Conversations, visuals, Android transport, account-profile switching UI, durable cloud erasure/cleanup and independent cloud recovery remain unimplemented. The current conflict UI resolves note edits; other conflict/deletion recovery is manual. History is retained indefinitely until epoch-aware compaction is implemented.

See [setup and delivered scope](../firebase-setup.md). Existing unrelated worktree changes were preserved.

## Google sign-in and AI settings update

The subsequent `2.3.0-cloud.2` Windows preview registers a bundled public Firebase client configuration and uses a Firebase Hosting login page in the system browser. Google authentication is enabled, Firestore Standard is provisioned in `us-east1` with its free tier enabled, and Firestore rules/indexes plus Hosting are deployed. Billing and PDF object storage remain disabled. The earlier external-state paragraph records the initial checkpoint and is superseded by this update.

Live browser checks opened the real Google account chooser and proved a top-level loopback form returns the expected hosted Origin. `Referrer-Policy: origin` is necessary; `no-referrer` produced `Origin: null` and was rejected. Tokens remain in the form body and never enter URL parameters. The local callback verifies one-time state, origin, Google provider and matching refresh identity. Regressions cover invalid-origin/replay rejection, delayed persistence across logout and legacy-callback cancellation.

The user completed Google sign-in in the installed Windows app. A local status check confirmed an authenticated session, with cloud binding still disabled and no pending content upload. No personal identity or credential appears in this receipt.

AI settings now use one ChatGPT provider card and the same radio selection/save footer as Claude Code and Codex. The duplicate card and independent save flow were removed; account/model fields, polling lifecycle, inline errors and narrow layout were repaired. Sixteen AI/settings/onboarding browser tests passed, including a 390x600 layout check.

The update passed packaged Windows smoke (HTTP health, project creation, PDF import/extraction, assets, persistence and shutdown), installed successfully, and confirmed its hosted login endpoint without environment variables. The latest full suite reported 134 tests, 133 passed and the ordinary emulator-only case skipped, zero failures. Focused final auth tests and desktop session/vault tests passed. No signed publisher or cloud PDF backup claim is made.

## Live Firestore transaction correction

A user-created project and paper exposed a production-only failure after Google sign-in: the standalone Firestore `beginTransaction` REST method returned 403 for the Firebase user credential, while the emulator had accepted it. The app retained all three operations locally; the remote library sequence was still zero.

The transport now follows Firebase client transaction semantics: batch-read documents, then atomically commit the library/entity/change/receipt with document update-time/create preconditions. This preserves optimistic concurrency and does not require server IAM credentials or weaker Security Rules. A regression explicitly rejects standalone server transaction endpoints and asserts all four commit preconditions.

The corrected worker processed the original queued operations using their original IDs. Live Firestore inspection confirmed the project and source metadata, sequence three, and an empty pending queue. Paper content-hash metadata matched the local record. PDF bytes and conversation history remain outside the current deployed synchronization scope.

The updated transaction transport passed the eight Firestore/Storage emulator tests, including competing clients and two local database clients restoring a verified fixture PDF. Full regression suite: 135 reported tests, 134 passed, one ordinary emulator-only skip, zero failures. Live user data and credentials are excluded from this receipt.

## Cloud interface and Windows upgrade acceptance

Windows Cloud Preview `2.3.0-cloud.3` was installed after the user closed the preview and then reopened successfully. Packaged native smoke passed. The installed app preserved its Google session, enabled library binding, one paper, one conversation and two saved messages. An installed-app sync completed with zero pending operations and no reported error. The regular pdfpal installation was left untouched.

The cloud dialog now separates account and synchronization status, shows pending operations and last successful sync, and provides retry, pause/resume, library selection and sign-out controls. Its scope disclosure explicitly distinguishes synchronized metadata from local PDF files and local questions/answers. Conflict comparisons and the narrow-screen layout were repaired. All six cloud-settings browser tests and the frontend build passed; the 390x600 dialog screenshot was visually inspected.

Diagnostics and usage analytics remained disabled in the installed preview. This upgrade does not add cloud PDF or conversation backup.

## Regular Windows installation upgrade

At the user's request, the same validated `2.3.0-cloud.3` application was packaged with the regular `io.pdfpal.desktop` identity and installed over the existing per-user Windows pdfpal installation. The regular app was already closed. The normal pdfpal executable and Start menu shortcut were verified, and the installed application opened its existing library on port 8200 with Firebase configured.

Before upgrading, the complete library, desktop profile and installed application were backed up under `%LOCALAPPDATA%\pdfpal-backups`. A read-only SQLite integrity check passed. Checksums of all existing columns and rows in fourteen content tables matched before backup, in the backup and after the installed app migrated the database. The preserved library contains five projects, 37 sources, eight collections, two notes, 46 annotations, 13 chat sessions and 160 chat messages, plus Kindle conversations, visual explanations and indexed content. Packaged Windows smoke also passed.

The existing regular desktop profile was retained. Google sign-in and synchronization remain inactive there until the user signs in and creates a cloud library for this populated local library. The separate Cloud Preview installation, test library and Google session remain available. Diagnostics and usage analytics are disabled in the regular app.
