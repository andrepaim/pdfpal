# Firebase library sync and telemetry

The optional cloud integration uses Firebase Authentication, Firestore Standard, and Cloud Storage directly from the local backend with the signed-in user's credentials. No service-account key or separately hosted Fastify/Cloud Run server is needed. SQLite remains the working library and durable offline queue. The Windows main process protects saved Firebase credentials using Electron safeStorage; the standalone CLI/browser server keeps credentials in memory and requires sign-in after restart.

## Delivered scope

Projects, nested collections, PDF source metadata, reading position, Markdown notes and highlights enter a transactional SQLite outbox, including changes made by the CLI. Operations are bound to an account, library and generation. Firestore transactions commit the entity revision, ordered change, immutable receipt and library sequence together. Security Rules enforce ownership and companion writes. The worker keeps remote acknowledgements separate from optimistic local revisions. Incoming changes and cursors commit locally together.

PDF transfers use private, immutable source/hash paths. Downloads are size/hash checked and indexed locally. PDF storage is optional; the interface explicitly labels metadata-only configuration. Only actual uploaded/downloaded files count as file synchronization. Existing local data is backed up before binding. Downloading an existing cloud library currently requires an empty local library. One local database is bound permanently to one cloud library; use a separate PDFPAL_DATA_DIR for another library/account.

Conflicting edits pause synchronization and preserve both versions. The interface resolves note edits against the latest remote revision; other conflicts, including remote deletion of a locally edited note, currently require manual recovery/export. Acknowledged receipts and tombstones are retained; there is no history pruning.

Conversations, visual explanations, Android transport, profile-switch UI, durable account erasure, orphan cleanup and independent cloud backup are outstanding. This is a desktop sync alpha, not completion of the broader roadmap. Do not describe it as a complete backup of all pdfpal content.

## Active Firebase setup

The dedicated project is `pdfpal-cloud-20261104`. Google authentication is enabled. The Firestore Standard database is provisioned in `us-east1` with its free tier enabled, and the reviewed rules/indexes are deployed. The system-browser login page is deployed on Firebase Hosting at `https://pdfpal-cloud-20261104.web.app/login.html`.

The application bundles public Firebase project identifiers and loads client configuration from the project's HTTPS Firebase Hosting initialization endpoint when sign-in or token refresh needs it. No API key is committed to the repository or embedded in the installer. These client API keys identify the Firebase project; Security Rules and Google sign-in authorize access. Desktop OAuth client credentials are not required for the normal flow. Click **Cloud library → Sign in with Google**, choose the Google account in your system browser, then return to pdfpal and explicitly enable synchronization. Sign-in alone uploads no documents. For an existing local library, choose **Create a new cloud library** and **Enable sync**. Connecting an existing cloud library requires an empty local library.

The hosted page keeps Firebase credentials in memory. A random, expiring state and the local port travel in the URL fragment, which is removed after reading. Credentials return in a top-level form POST to the local app, never in the URL. The local callback verifies the hosted Origin, single-use state, Google provider identity and matching Firebase refresh credential before saving a native protected session. The page sends only its origin as referrer so browsers preserve the verified Origin on the loopback form navigation.

PDF file storage is not enabled in this project and billing remains unattached. The app labels the current scope as **metadata sync only**. Configure Storage and its rules only after explicitly authorizing a billing-enabled bucket. This limitation is independent of Google sign-in: projects, collections, notes, highlights and reading progress can synchronize now.

Use a Firebase-only API restriction allowlist for client keys, excluding unrelated services such as Gemini. Update the Firebase web app's API-key association when rotating a key; Hosting deployment refreshes the runtime initialization endpoint.

Advanced deployments may override the public config through the variables in `cloud/client.env.example`. `PDFPAL_FIREBASE_LOGIN_URL` selects a reviewed hosted sign-in page for a different deployment. Legacy native OAuth remains available when `PDFPAL_GOOGLE_CLIENT_ID` is explicitly configured.

To update deployment configuration:

```sh
npm run build:auth
firebase --config cloud/firebase.json deploy --only firestore,hosting --project pdfpal-cloud-20261104
```

No service-account credential is bundled. End-user account selection remains interactive. Live Google account completion and cross-device sync acceptance must be distinguished from emulator tests and opening the actual Google chooser.

## Local use and recovery

The reader, notes, extraction, search and AI continue locally. Sign-in for cloud identity is separate from AI-provider sign-in. Pause stops cloud work while continuing to record durable edits. Sign-out clears cloud credentials and retains the local library. Signing in as another account cannot upload the retained account's outbox.

The CLI uses the local server for cloud commands:

```sh
pdfpal cloud login
pdfpal cloud status
pdfpal cloud sync
pdfpal cloud pause
pdfpal cloud resume
pdfpal cloud logout
```

To restore into another library, start pdfpal with an empty `PDFPAL_DATA_DIR`, sign into the same account and select the existing cloud library. Keep the original data directory and its migration backups during alpha testing. A source's `pdf_text`, chunks, local paths, executable settings, extension tokens and AI credentials are excluded from portable records.

## Telemetry and tracing

Privacy controls store diagnostic and usage consent separately, defaulting off. A bounded local diagnostic journal stores only event names, outcomes, capped durations and counts. Unknown fields are discarded; telemetry failures cannot fail a library operation. Revoking diagnostics clears the journal.

Configured renderer adapters use Firebase Analytics allowlisted events and Performance custom traces for search/import/sync actions. Automatic page-view reporting and advertising personalization/signals are disabled; the page location is reduced to its origin. The Performance adapter disables automatic instrumentation and exposes only explicit operation traces. Revocation disables collection. Packaged Electron behavior and actual dashboard delivery still require staging acceptance; a local unit test is not evidence of ingestion.

Native Windows/backend crashes are not integrated into Crashlytics. Android Crashlytics, native symbol upload and optional desktop ingestion through a Firebase Function remain separate work. Do not upload PDF contents, titles, notes, queries, prompts, answers, email, URLs, paths or tokens to telemetry. SDK automatic behavior must pass a network/redaction acceptance check before enabling collection for real users.

## Verification

```sh
npm run typecheck
npm test
npm run build --workspace frontend
npm run test:firebase
npm exec --workspace frontend -- playwright test e2e/cloud-settings.spec.ts
```

The Firebase command needs Node 22, Java 21 and Firebase CLI. It runs only against `demo-pdfpal-sync` on loopback ports 8081/9199, with no real credentials. Tests cover production REST transactions, duplicate retries, competing clients, ownership, forbidden partial writes, immutable history, stale revisions, private PDF transfer and two local database clients restoring PDF/notes. Tests reject non-loopback or non-demo emulator configuration.

Storage test fixtures are synthetic. Local test suites verify outbox transaction rollback, pause behavior, no upload echo, preserved conflicts and consent/redaction/error containment. Existing migration/server/CLI tests remain required. Live Google authorization, Windows protected credential persistence, cloud telemetry, region/cost measurements and signed two-installation acceptance are additional release gates.

## Cost and operations

Google social sign-in, Analytics, Crashlytics and Performance have no-cost offerings. Firestore Standard has a recurring free allowance. Firebase Storage requires billing even when usage stays within its free allowance; eligibility depends on bucket location. Functions, managed backups, retention, build artifacts and cross-region traffic can incur additional charges. No functions or managed backups are deployed by this implementation.

Allowances are shared by the project, not multiplied by user count. A logical sync commit writes four documents and reads several others. Budget alerts do not cap spending. Retaining all changes/receipts grows storage over time; define compaction/epochs before broad rollout. Local backup/export remains necessary because synchronization propagates deletion.

Verification receipt: [Firebase desktop alpha](evidence/firebase-desktop-alpha.md).

Source architecture reference: `../distillpod/docs/android/firebase-sync-telemetry-plan.md` in the sibling checkout. This integration adopts its direct Firebase/outbox/consent pattern; its Android code and production setup are independent.
