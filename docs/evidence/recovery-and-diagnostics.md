# Backup, recovery and error-report verification

Date: 2026-11-05. Release: [2.5.0-preview.1](https://github.com/andrepaim/pdfpal/releases/tag/desktop-v2.5.0-preview.1). Application source: `c5bb49e5abb04c0b8c16cd1c71600f0a299c6a6e`.

## Delivered behavior

SQLite schema 14 adds a transactional deletion journal and a bounded, separately consented error-report queue. Full local snapshots include the database and managed PDFs, verify integrity and file hashes, and preserve manual/safety copies. Scheduled backups default to daily while the normal library is open. Recently deleted supports 30-day/latest-100 recovery and waits for complete cloud deletion groups. Restore refuses identity collisions; copying assigns new identities. Retained PDFs are checked before Undo and unavailable bytes are not served as recovered files.

Full restoration creates a separate library with cloud bindings/outbox cleared, error sharing and scheduled backups off, interrupted jobs stopped, and extension pairings revoked while retaining readable history. The Windows app switches to registered recovered directories and can return to the original. The CLI's explicit `serve --data-dir` overrides an inherited database path so a recovery server cannot accidentally open the original database.

Content-free error reports use owner-scoped Firestore documents and strict immutable schemas. Sharing defaults off independently of older local diagnostic consent. Queue retries are idempotent, account-bound, capped at 20 new records/day, and clearing local history does not reset that daily budget. Revocation cancels requests and unbinds unsent reports. The app previews, exports and removes reports without uploading raw messages, paths or research contents.

PDF transfers have a separate per-device opt-in, availability/hash status and retry controls. Transfers wait until source metadata is acknowledged. Missing local files can be downloaded again; PDF errors do not stop notes or saved-conversation synchronization. The bundled production project still has no PDF Storage configured, and no billing account was attached by this update.

## Evidence

- Full local `npm test`: 154 tests reported, 153 passed and one ordinary-run emulator test skipped; coverage passed. The subsequently added compiled-CLI isolation test passed in its six-test CLI suite. The release workflow reran all committed tests successfully.
- Chromium frontend: 74 passed, including actual note Undo, verified snapshot creation, separate restoration preserving newer text, privacy opt-in persistence, rejection of content-bearing report input, and narrow-window controls.
- Chromium extension: 23 passed. Desktop unit checks: 33 passed. Package installation outside the checkout and deterministic extension archive checks passed.
- Firestore and Storage emulators: 11 tests passed with zero skips, using production REST transport and rules. Tests reject cross-account reports, unknown codes, extra content fields and mutations to existing report receipts. Two SQLite clients verify that PDF bytes remain absent before per-device opt-in, then transfer and recover matching bytes and notes afterward.
- An additional isolated Windows Electron profile ran the committed desktop code with synthetic notes and a fixture PDF. It created a complete backup, edited the original note afterward, opened a separate recovery library through native IPC/relaunch, verified recovered PDF bytes and disabled cloud state, returned through native IPC to the original, confirmed the newer note remained, and quit gracefully. The harness waits for the restarted native service to be ready before sending commands. The user's regular profile and library were separate from this test.
- [GitHub Windows release workflow](https://github.com/andrepaim/pdfpal/actions/runs/42003381771): plan, regression, native build/installer acceptance and publication succeeded. Release tag resolves to the exact application commit above. The published installer and manifest passed SHA-256 verification before and after copying the installer to Windows. No duplicate workflow dispatch was used.
- Credential scan passed; GitHub reported zero open secret-scanning alerts after publication. No client API-key literal was introduced.
- The reviewed additive diagnostic rules compiled and were deployed to `pdfpal-cloud-20261104`. No Functions, Cloud Run, Storage bucket, billing activation or Analytics property was added. Actual personal cloud-error ingestion remains dependent on the user's separate opt-in.

## Limits

These are local/emulator, isolated Windows and unsigned engineering-release checks. They do not claim signed publisher identity, live PDF Storage activation, full Crashlytics dumps, automatic server-side retention, or an independent cloud backup. Shared-report retention runs when a client uploads/views reports, and can wait while all clients are offline. Removing a trash entry does not securely erase retained orphan PDF bytes or existing backups. See [backup behavior](../backup-recovery.md) and [error-report fields and retention](../error-reports.md).
