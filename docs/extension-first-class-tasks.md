# Make the Kindle companion a first-class pdfpal interface

Status: implementation and local verification complete; master delivery and remote CI verification are in progress.

Reviewed on 2026-10-23 against local `master` at `6ffde76`, including the uncommitted Kindle companion, visual explanations, selection popup, slash command, and icon work. This document supersedes the earlier high-level promotion plan. The [original extension plan](kindle-browser-extension-plan.md) remains historical context.

## Outcome and scope

A new user can discover Kindle support in the README, start pdfpal, download and install its matching extension from the web interface, click **Connect to pdfpal**, approve in a local browser tab, choose or create a project, and ask a book or selection question. No terminal-generated pairing code is needed for the normal path.

PDF web reader, Kindle companion, and CLI become three documented and tested interfaces to the same local application. Keep the existing dark theme, selection behavior, `/visual` command, configured agent, and saved-note workflow.

This work includes packaging, connection management, documentation, regression coverage, and integration into `master`. It does not include Chrome Web Store submission, native Kindle PC integration, full-book ingestion, browser-profile discovery, new reader hosts, or merging Kindle conversations into PDF chat sessions. Publishing an npm version is a separate release action: pushing `master` does not update the registry.

## What the implementation changes about the earlier plan

| Finding in the current implementation | Consequence for this plan |
| --- | --- |
| `src/server/extension.ts` rejects ordinary web origins and requires a bearer token everywhere except `/pair`. | Add separately guarded local-web management routes and narrowly scoped pre-pairing bridge routes. Do not relax the existing bridge globally. |
| `/api/auth/me` in `src/server/app.ts` always returns a local user. It is not an authenticated approval session. | Explicit browser approval needs loopback/Host checks and same-origin mutation protection of its own. |
| `extension/src/companion.tsx` owns pairing inside the panel. Storage restoration already has a race regression test. | Keep the restoration barrier; persist pending pairing before network activity and resume when the panel reopens. Opening an approval tab must not require the panel to remain alive. |
| `kindle_conversations`, `kindle_turns`, saved-excerpt lookup, and private visual artifacts are scoped by `client_id`. | Healthy updates must preserve the token AND client ID. Fresh pairing cannot silently recover old conversations merely by matching the public extension ID. |
| `projects()` currently selects the first project if its saved ID is missing, and the connection dialog closes before an empty-project form is populated. | Define explicit zero/one/many-project behavior and make project creation visible after pairing. |
| `ExtensionAuth.list()` exposes connection ID, origin, creation date, and revocation date, with no browser-profile label. | Call these paired connections. Add editable labels; do not claim to know Chrome profile names. |
| Disconnect removes local credentials, then swallows failure to revoke on the server. | Distinguish local removal from confirmed server revocation and provide web management for stale connections. |
| Root `build` omits the extension, `files` omits extension assets, and `prepare` invokes `build`. | Packaging and lifecycle scripts need to work together, including installation of a tarball without development dependencies. |
| Root `test:extension` builds the server and extension, but the visual test also opens the built web UI. | Make its prerequisites explicit so it works from a clean checkout without stale frontend output. |
| The server searches `frontend/dist` relative to the working directory before its package directory and serves a SPA fallback. | Resolve distributed extension assets relative to the installed package; test from an unrelated directory and return real API errors when assets are missing. |
| The extension uses its own Playwright dependency and the update test uses `Extensions.loadUnpacked`. CI only installs the frontend browser. | Give extension browser tests a CI job using the extension workspace's browser installation. |
| README calls the companion optional and makes broad claims about no uploads or usage limits. | Give both reading paths equal prominence; describe local storage/OCR separately from agent-provider processing and provider limits. |
| The working tree already contains substantial extension and visual work, plus unrelated downloaded PDFs. | Inventory and review the pending implementation before integration. Stage explicit source paths, not the entire working tree. |

These findings come from source review. No new test run or live pairing experiment was performed during this planning review.

## Agreed design for implementation

### User flow

1. The web app has an **Extension** link on the projects home and project navigation. Its page provides the matching ZIP, installation steps, and paired-connection management.
2. After installing, the extension offers **Connect to pdfpal** as the primary action. Address configuration and manual code entry are under advanced settings.
3. The extension first restores and validates any existing connection. For a new connection, it creates an expiring request and opens a local approval page in a new tab.
4. The approval page identifies pdfpal's local address and the requesting extension, explains access to projects and agent-backed chat, and offers **Allow connection** and **Deny**. Viewing the page never approves.
5. The extension finishes the exchange, persists the connection, and shows project setup. Preserve a valid saved choice; auto-select the only project; ask when there are several; show an inline create-project form when there are none. Project choice selects context, not an authorization boundary: the existing token can access all projects.
6. Closing the panel while approving is supported. Reopening resumes the pending exchange until it expires. An unavailable server produces **Retry** and startup instructions, not a demand to pair again.

### Pairing protocol and recovery

Use a short-lived request ID plus an independent, cryptographically random polling secret held only by the initiating extension. Persist pending state in trusted `chrome.storage.local`, bound to the exact server origin and runtime extension ID, before creating the request. Only the public request ID belongs in the approval URL. Use a five-minute lifetime and bounded attempts.

The request state machine is `pending -> approved -> claimed`, with terminal `denied`, `cancelled`, and `expired` outcomes. Approval and claim must be transactional and idempotent. Cancellation cannot undo a successfully claimed connection; disconnect/revoke handles that case.

Avoid a one-shot credential response that can strand a connection if the network drops. The proposed claim design has the extension generate and persist its future 32-byte bearer token before claiming. A claim submits that token plus the polling proof; the server stores only their hashes and returns connection metadata. An identical retry returns the same client ID; a different token or proof cannot reclaim the request. This preserves hashed-only server credential storage and lets a reopened panel finish after a lost response. Requests expire after five minutes. Terminal rows are cleaned up after one day when new requests are created. A claimed request can be retried with both original secrets and a still-valid token; after cleanup, authenticated `/status` recovers the connection. Creation/manual exchange is limited to ten attempts per minute; bridge polling is limited to 1,200 requests per minute. Web mutations are limited to 60 per minute. Cancellation that races a completed claim explicitly revokes that credential; offline cancellation reports that server confirmation was unavailable.

Keep `/api/extension/pair` and the existing CLI commands compatible. Guided pairing uses the pinned extension identity, but that public ID is not a secret or proof of user consent. Existing valid connections never need to enter the new flow. A revoked or lost credential requires new consent; do not attach it to another client's history automatically.

### Route boundaries

The routes below are implemented. Shared protocol constants and response types live in `src/shared/extension-pairing.ts`.

| Surface | Proposed routes | Authority |
| --- | --- | --- |
| Extension capability check | `GET /api/extension/capabilities` | Loopback only; returns pairing protocol 1 and the 1,500 ms polling interval, no user data. |
| Request creation | `POST /api/extension/pairing-requests` | Loopback, extension-origin checks, bounded creation; request ID and random proof, no access token yet. |
| Poll, claim, cancel | `GET /api/extension/pairing-requests/:id`; `POST .../:id/claim`; `DELETE .../:id` | Request-specific secret in a header, bound extension identity and server origin. Claim token only in the JSON body. |
| Approval UI | `/extensions/connect?request=<public-id>` | Same local web app; request ID grants no exchange capability. |
| Approval metadata and decision | `GET /api/extensions/requests/:id`; `POST .../:id/decision` | Local-web guards; mutations require exact same origin including port and JSON. No token/proof in responses. |
| Management | `GET /api/extensions/connections`; `PATCH .../:id`; `DELETE .../:id` | Local-web guards; only labels and non-secret connection metadata. |
| Distribution | `GET /api/extensions/package`; `GET /api/extensions/download` | Local packaged metadata/archive; explicit missing-build errors. |

Do not enable wildcard CORS, accept web origins on authenticated bridge routes, place secrets in URLs, or add arbitrary redirect destinations. Protect the approval page against framing, avoid referrer leakage, and keep pairing bodies/headers out of logs. Tests must verify actual browser requests as well as injected HTTP requests.

## Task index and dependencies

All checkboxes refer to implementation work, not completion of this review. Sizes are relative planning estimates: S = contained change, M = several related components, L = cross-layer work with recovery cases.

| ID | Deliverable | Size | Depends on |
| --- | --- | --- | --- |
| EXT-01 | Inventory and isolate pending work | S | — |
| EXT-02 | Finalize pairing contracts and compatibility behavior | M | EXT-01 |
| EXT-03 | Persist pairing requests and connection labels | M | EXT-02 |
| EXT-04 | Implement guarded pairing and management APIs | L | EXT-03 |
| EXT-05 | Build resumable extension connection UX | L | EXT-04 |
| EXT-06 | Build web approval and connection management | M | EXT-04 |
| EXT-07 | Build and package the extension as part of pdfpal | M | EXT-01 |
| EXT-08 | Serve the bundled download and installation guide | M | EXT-06, EXT-07 |
| EXT-09 | Add pairing and upgrade browser regression tests | L | EXT-05, EXT-06, EXT-08 |
| EXT-10 | Validate the installed npm artifact | M | EXT-07, EXT-08 |
| EXT-11 | Make all interfaces mandatory CI checks | M | EXT-09, EXT-10 |
| EXT-12 | Rewrite product and contributor documentation | M | EXT-05, EXT-06, EXT-08, EXT-11 |
| EXT-13 | Complete release review and integrate into master | M | EXT-01 through EXT-12 |

Suggested sequence: inventory, pairing contract, backend, both UIs, distribution, integrated tests, documentation, master integration. Packaging can be implemented independently of pairing after the inventory; final verification must cover their combined result.

## Detailed tasks

### EXT-01 — Inventory and isolate the existing work

Files: current tracked changes, new `extension/`, new core/server/shared visual and Kindle modules, tests, and documentation.

- [x] Record the starting commit and a path-level inventory of existing changes; create an integration branch without discarding the current working tree.
- [x] Separate already implemented companion/visual work from the new promotion changes in the review and commit plan. Include the popup, command hint, and small icon the user already accepted.
- [x] Leave downloaded PDFs and their `:Zone.Identifier` files outside every commit. Check ignored artifacts, local data, credentials, and browser profiles are excluded.
- [x] Fetch `origin/master` when integration begins and inspect divergence. The currently recorded remote-tracking ref is not evidence that the remote is still unchanged.
- [x] Establish the baseline using the existing typecheck, backend, web, and extension checks in isolated test data directories; record any existing failure separately.

Acceptance: the full intended change set is accounted for, unrelated files remain untouched, and later failures can be distinguished from the baseline. No existing pairing or project data is reset.

### EXT-02 — Finalize the connection contract

Files: new shared pairing types/schemas under `src/shared/`, `src/core/extension-auth.ts`, `src/server/extension.ts`, `extension/src/companion.tsx`, and this plan if endpoint details change.

- [x] Define request states, payloads, protocol version, expiry, bounded polling interval, error codes, and retry behavior for the routes above. Specify which fields are public and which are secrets.
- [x] Specify client-generated claim-token persistence and retry rules: one approved request produces one client; repeated identical claims are safe; different claims conflict; revocation cannot be undone by replay.
- [x] Define create-request idempotency and behavior after response loss, panel closure, browser restart, server restart, expiry, denial, cancellation, and changing the configured address.
- [x] Define new-extension/old-server behavior: capability detection, explicit upgrade guidance, and manual-code fallback. Keep old-extension/new-server pairing and authenticated calls working.
- [x] Separate connection errors from agent errors. A provider authentication failure must not discard a valid extension connection or trigger new pairing.
- [x] Define labels, default project selection, and disconnect semantics. Retain existing client identity on healthy reconnect; document the consequences of genuinely fresh pairing.

Acceptance: implementers can build client and server from the same contract without inventing lifecycle behavior independently. The token-receipt failure case has a concrete recovery sequence.

### EXT-03 — Add durable request state and connection labels

Files: `src/core/database.ts`, `src/core/extension-auth.ts`, `test/integration/database-migration.test.ts`, focused auth tests.

- [x] Add schema version 9, assuming no intervening migration. Use the existing pre-migration backup and transactional migration pattern.
- [x] Add a pairing-request table with request ID, proof hash, extension origin, lifecycle status, timestamps/expiry, and claimed-client linkage. Store no raw polling secret or bearer token.
- [x] Add an optional user-editable connection label without changing existing client IDs, token hashes, or revocation state. Supply a sensible display fallback for old rows.
- [x] Implement atomic creation, decision, claim, cancellation, expiry, and bounded cleanup. Keep claimed retries valid for the documented window and require credential validation afterward; never resurrect revoked clients.
- [x] Preserve existing manual codes and existing `pair`, `list`, `revoke`, and `authenticate` behavior.
- [x] Test fresh databases, schema-8 upgrade, rerunning migrations, and existing older migration fixtures. Update fixtures that currently assume version 8 or insert full rows positionally.

Acceptance: existing tokens still authenticate after migration; existing Kindle conversations, visual artifacts, notes, and PDF reading progress retain their owners/content. Concurrent claims cannot create duplicate connections, and database inspection finds hashes only.

### EXT-04 — Implement scoped HTTP endpoints and their tests

Files: `src/server/extension.ts`, new `src/server/extension-management.ts`, `src/server/app.ts`, `test/integration/extension.test.ts`, new pairing/management integration tests.

- [x] Register narrowly scoped unauthenticated capability/request routes before bearer enforcement, without weakening authenticated feature routes.
- [x] Add local-web request metadata, allow/deny, list, rename, and revoke routes separately from the extension-origin bridge.
- [x] Enforce loopback IP and valid Host checks on both surfaces; validate origin including port on web mutations, JSON payloads, schema bounds, and request-specific proofs. Reject malformed or mismatched origins and `Origin: null`.
- [x] Preserve current CLI-compatible manual exchange behavior. Confirm how the actual extension sends Origin headers; do not infer this only from `app.inject` fixtures.
- [x] Add bounded creation/decision/claim attempts and sensible polling limits. Return machine-readable states/errors with `Cache-Control: no-store` for connection data.
- [x] Ensure logs and errors never expose raw credentials, request proofs, or claim bodies. Configure approval-page framing/referrer protection without breaking existing assets or reader pages.
- [x] Test allow/deny/expiry/cancel, wrong proof, wrong identity, foreign web origins, missing mutation origin, invalid Host, non-loopback requests, duplicate/concurrent decisions, lost-response retries, and revoke-after-claim replay.

Acceptance: only an explicitly approved request can become a connection; possession of its URL alone cannot claim credentials. Existing authenticated extension operations and manual pairing still pass their authority tests.

### EXT-05 — Replace code-first setup with resumable connection UX

Files: `extension/src/companion.tsx`, proposed `extension/src/connection.ts`, `extension/panel.html`, existing panel styles; `extension/src/background.ts` only if required by lifecycle handling.

- [x] Extract connection lifecycle handling from the chat controller enough to test restore/start/wait/claim/retry/cancel independently. Preserve the existing storage-restoration barrier and duplicate-click guard.
- [x] Make **Connect to pdfpal** primary; keep address and **Use a pairing code** under advanced options. Preserve the existing loopback URL restrictions and custom-port support.
- [x] Persist the pending request before starting it, open the approval tab, poll while the panel is active, and resume on reopening. Stop obsolete polling when address/request changes; ignore stale responses.
- [x] Do not depend on the side panel or service worker remaining alive during approval. Persist the future claim token before submitting it and finish safely after a lost response or failed final storage write.
- [x] Show separate states for waiting, connected, denied, expired, unsupported server, unavailable server, and revoked connection. Server/network failure retains existing credentials and offers Retry.
- [x] Implement zero/one/many-project selection rules; expose project creation immediately when needed. Preserve draft text, attachments, saved project choice, and chat context during healthy reconnects.
- [x] On disconnect, report whether server revocation succeeded. Local forgetting must not falsely imply that the server credential was revoked; link to web connection management when appropriate.
- [x] Keep storage trusted-context-only, retain the pinned manifest key, and avoid new broad permissions. Use an internally constructed local approval URL.

Acceptance: a first-time user pairs without copying a code; an existing user reloads or updates without another approval. Closing the panel during approval, changing ports, or restarting the server produces recoverable states without duplicate clients or lost valid identity.

### EXT-06 — Add web approval and connection management

Files: `frontend/src/main.tsx`, new `frontend/src/pages/ExtensionsPage.tsx` and approval component/page, new API client in `frontend/src/lib/`, `frontend/src/pages/ProjectsPage.tsx`, `frontend/src/pages/ProjectView.tsx`.

- [x] Add `/extensions` and `/extensions/connect` routes, with navigation links on home and project pages. Reuse the existing theme, typography, buttons, and compact icons.
- [x] Display request identity and local server address, plain-language access scope, expiry, Allow, and Deny. Do not approve on load, refresh, or React StrictMode effects.
- [x] Show pending/approved/claimed/denied/expired states accurately. After approval, say to return to the extension; only report Connected when the claim actually completes.
- [x] List paired connections with optional label, creation time, short identifier, and revoked state. Support rename and disconnect without displaying tokens or pretending to detect Chrome profile names.
- [x] Explain that disconnect keeps notes and stored records but invalidates access; a new pairing does not automatically inherit another connection's chat history.
- [x] Support keyboard navigation, visible focus, accessible state announcements, invalid request links, and server/network errors.

Acceptance: approval is explicit, refresh-safe, and accessible; denying creates no client. A user can distinguish and revoke two connections, and revocation is enforced on the next extension request.

### EXT-07 — Make extension builds and archives part of the distribution

Files: root `package.json`/lockfile, `extension/package.json`, `extension/manifest.json`, `extension/build.mjs`, new archive script, `.gitignore` as needed.

- [x] Include server, frontend, extension typecheck/build, and extension archive generation in the normal root build with an explicit dependency order and no lifecycle recursion.
- [x] Add the built extension and its downloadable archive/metadata to the npm `files` allowlist. Choose one canonical package path for the server and package tests.
- [x] Generate the ZIP using cross-platform Node tooling. Define deterministic ordering, timestamps, file permissions, and compression; include manifest, JS/CSS/fonts, OCR worker/WASM/language assets, instructions, and relevant licenses.
- [x] Exclude test profiles, test results, previous archives, local PDFs, credentials, and unnecessary development files. Decide explicitly whether source maps belong in the distributed build and ensure paths do not leak machine-specific checkout locations.
- [x] Verify manifest and workspace versions agree; retain `billjanehfdgcakkbbefbjobocjlinen`. Choose the next extension version once the feature set is final.
- [x] Audit `prepare` and any added pack hooks so source installation builds correctly while a published tarball runs with production dependencies and already built assets.
- [x] Ensure `npm run test:extension` builds every required artifact, including the frontend needed by `visual.spec.ts`, or calls a clearly defined equivalent prerequisite.

Acceptance: a clean root build creates an installable extension and archive without manual ZIP commands; two clean builds under the same pinned toolchain produce the same archive hash. The package contains all local OCR assets and preserves the extension ID.

### EXT-08 — Deliver the extension from the running web app

Files: `src/server/extension-management.ts`, `src/server/app.ts`, a package asset-path helper if needed, `frontend/src/pages/ExtensionsPage.tsx`, server integration tests.

- [x] Resolve package assets relative to the installed module using filesystem-safe URL conversion, including paths with spaces. Do not require the repository as the working directory.
- [x] Add package metadata and download endpoints with actual version, archive size/checksum, appropriate MIME type, and attachment filename. Read a fixed known asset path, not arbitrary requested filesystem paths.
- [x] Show a prominent Download button and concise steps: extract to a stable folder, enable Developer mode, Load unpacked, pin toolbar icon, refresh Kindle, Connect.
- [x] Explain updating in the existing folder and using Reload. Removing the extension clears stored connection data; startup cannot install or start a local process on the user's behalf.
- [x] Provide useful missing-build and incompatible-version states. A missing archive must not return the SPA HTML or a successful empty download.
- [x] Keep the source-checkout installation path documented for contributors while making the bundled download the end-user path.

Acceptance: the download comes from the running pdfpal version, extracts with `manifest.json` at the documented level, and loads in Chrome. The same route works when pdfpal runs from outside the repository.

### EXT-09 — Cover the complete browser journey and regressions

Files: new `extension/test/pairing.spec.ts`, `extension/test/update.spec.ts`, existing capture/visual tests, focused frontend E2E tests.

- [x] Exercise an actual extension-created approval tab and browser fetches against a real temporary server: Allow, Deny, expire, cancel, double-click, custom port, and invalid request.
- [x] Cover closing/reopening the panel before approval and before/after claim, browser restart with pending state, server restart, lost create/claim responses, and delayed initial storage restoration.
- [x] Cover zero/one/many projects, deleting a previously selected project, explicit project creation, and stable selection after reconnect.
- [x] Extend the existing update test to assert unchanged client ID, token, project, and readable preexisting chat/visual history across reload, another extraction directory, and browser restart.
- [x] Cover revoked connection, unavailable server, and agent authentication failure as distinct states; only genuine revocation/loss should require new approval.
- [x] Keep manual pairing coverage for older clients and add new-client/older-server fallback coverage. Update selectors in existing tests without turning every chat test into a full onboarding test.
- [x] Retain native/iframe selection, local light/dark OCR, actual region capture, long-running chat recovery, note saving, `/visual`, PDF selection popup, and offline export coverage.
- [x] Inspect setup and connected layouts at 320px and 390px, plus web keyboard/focus behavior. Use original/synthetic content for screenshots.

Acceptance: the normal path requires no code copying, upgrade preserves history, and failure paths do not mint duplicate clients. Automated tests use isolated profiles/data and fixture agents, with no Amazon login or real model billing.

### EXT-10 — Test the artifact users actually install

Files: new package smoke-test script/tests, package scripts, distribution tests.

- [x] Build and create a real npm tarball, then inspect its allowlist. A dry run alone is insufficient.
- [x] Install the tarball into a temporary prefix with production dependencies using the documented supported Node version. Do not use the source checkout or workspace symlinks at runtime.
- [x] Run the installed CLI/server from an unrelated directory with a temporary data directory and fixture agent. Exercise help/startup, frontend assets, extension metadata, and download.
- [x] Download and extract the served ZIP, verify its contents and pinned identity, and use that extension artifact for a fresh guided pairing plus one fixture chat and saved note.
- [x] Include a path containing spaces and verify cleanup of temporary processes/files. Check the tarball does not require frontend/extension build dependencies on end-user startup.

Acceptance: the packaged product supports the complete install/connect/ask flow outside the repository. Record package size and included files so unexpected growth is visible.

### EXT-11 — Make extension and packaging checks mandatory in CI

Files: `.github/workflows/ci.yml`, root package scripts, test artifact configuration where needed.

- [x] Keep backend coverage/typecheck and existing web browser checks; include extension compilation in the normal build.
- [x] Add an extension browser job that installs the extension workspace's Playwright Chromium and system dependencies before running its suite. Do not assume the frontend's browser revision is interchangeable.
- [x] Run the installed-package smoke test and deterministic-archive check in CI; share build artifacts only where that avoids duplicate work without hiding prerequisites.
- [x] Upload useful failure traces/screenshots and the matching extension ZIP as workflow artifacts, excluding browser profiles and credentials.
- [x] Ensure all jobs use temporary data directories and fixture agents, work from a fresh checkout, and are triggered on PRs/pushes to `master`.

Acceptance: failures in pairing, extension upgrade, local OCR, or package contents fail CI. Required local commands and CI commands exercise the same product paths.

### EXT-12 — Rewrite README and setup documentation around three interfaces

Files: `README.md`, `extension/README.md`, `docs/kindle-browser-extension-plan.md`, package/CLI descriptions, synthetic screenshots under `screenshots/`.

- [x] Rewrite the opening description and feature overview to present PDF reading, Kindle reading, and CLI automation. Retain the project's read-with-assistance philosophy.
- [x] Add equally discoverable PDF and Kindle quickstarts. The Kindle path starts with the installed web app's Extension page, then download/install/connect/approve/project/ask.
- [x] Add a representative Kindle panel screenshot and compact connection illustration/screenshots using synthetic text. Include alt text and ensure images render on GitHub.
- [x] Explain selections, OCR, metadata-only book questions, optional project context, notes, and `/visual`; accurately state that full Kindle text is not imported.
- [x] Correct privacy/cost claims: local library and OCR, agent-provider context processing, existing provider subscription/authentication and limits. Verify wording against actual data flow.
- [x] Replace primary terminal-pairing instructions with guided connection. Retain code pairing and `extension list/revoke` as advanced fallback; include server-not-running, wrong port/data directory, old server, revoked access, OCR, and update troubleshooting.
- [x] Update architecture to show SPA, extension bridge, and CLI sharing services/storage/agent configuration. Do not imply that Kindle and PDF chat histories use the same tables or that every interface exposes every operation.
- [x] Document full build, browser prerequisites, tests, package validation, supported reader hosts/English OCR, stable extension identity, and local single-user support boundary.
- [x] Label old plan/test counts as historical and link to this current work plan; avoid claiming old benchmark counts describe the finished release.
- [x] Distinguish repository/master instructions from registry availability until an npm release is actually published. Do not promise a global-install feature absent from the published version.

Acceptance: a reader can identify the correct install path and finish it without consulting source code. Every documented command/link/version matches the final implementation and available distribution.

### EXT-13 — Review, verify, and integrate into master

Files: complete intended source change set and release/task documentation.

- [x] Review the pending companion/visual implementation together with the new changes. Check schema evolution, connection ownership, cross-project boundaries, backward compatibility, package contents, and user-visible error states.
- [x] Finish coherent commits by concern; keep each buildable where practical. Stage explicit paths and inspect staged diffs for downloaded PDFs, secrets, generated browser artifacts, and unrelated work.
- [x] Fetch the current remote, integrate any new `origin/master` changes on the integration branch, resolve conflicts, and rerun checks affected by those changes.
- [x] Run the final typecheck, backend coverage suite, complete build, web browser suite, extension browser suite, and installed-package test on the candidate commit. Record actual results rather than copying historical totals.
- [ ] If updating the running local app, first ensure no chat/visual job is active. Restart after the final frontend build and verify hashed JS assets are served as JavaScript; static routes are registered at server startup.
- [ ] Merge into local `master` and push normally to `origin/master`; do not force-push. Verify the remote commit and CI result. If new remote changes land first, integrate and revalidate.
- [ ] Record the delivered extension/server versions, archive location, commit, and verification evidence. State npm registry publication status explicitly; prepare release notes without treating merge as publication.

Acceptance: the intended changes are on remote `master`, CI is green for the pushed commit, old healthy pairings still work, and unrelated local files remain uncommitted. If a required check fails, this task stays open.

## Final acceptance checklist

- [ ] README presents the web reader, Kindle companion, and CLI as supported interfaces.
- [ ] The installed web app supplies its matching, complete extension package.
- [ ] First-time guided pairing works without terminal code generation.
- [ ] Approval is explicit; denial, expiry, revocation, and cancellation are enforced.
- [ ] Panel/browser/server interruption and lost responses are recoverable without duplicate clients.
- [ ] Healthy upgrades preserve client ID, token, project, conversation history, and private visuals.
- [ ] Project setup is clear for an empty library and for multiple projects.
- [ ] Normal text chat, selection chat, `/visual`, OCR, and saved notes still work.
- [ ] Package installation and runtime work outside the source checkout.
- [ ] All required checks pass on the commit pushed to `master`.
- [ ] Documentation distinguishes master delivery from npm publication and accurately describes provider data flow.

## Implementation evidence — 2026-10-25

- Baseline: `6ffde76`; prior companion/visual work preserved in `b494d75`. Downloaded PDFs and `:Zone.Identifier` files remain outside the commits.
- Versions: pdfpal 2.1.0, companion 0.5.0, database schema 9; the pinned Chrome ID is unchanged.
- Typecheck and root build passed. Backend suite: **100 passed**, including coverage thresholds. Web suite: **40 passed**. Extension suite: **17 passed**.
- Browser coverage includes real approval tabs, reload/browser/server recovery, denied/cancelled/expired requests, lost create/claim responses, failed credential storage, explicit project choice and deletion recovery, offline retry, older-server guidance, provider-auth failure without losing pairing, and upgrade preservation of private chat/visual history.
- Root build creates `extension/dist` and `extension/package/companion.zip`. Two independent builds produced identical archive hashes. The ZIP includes bundled dependency licenses and local OCR assets.
- A real npm tarball was installed with production dependencies in a temporary path containing spaces, then run from an unrelated directory. Its downloaded extension paired through the UI, asked a fixture question, and saved a note. Package: approximately 25.1 MB / 344 files; extension ZIP: approximately 11.7 MB.
- Setup, approval, and the Kindle visual pane were inspected visually using synthetic content. README screenshots are committed under `screenshots/`.
- The chat scrolling check caught a resize-after-reopen issue; a resize observer now preserves following the latest text response without pulling readers away from earlier messages or visual steps.
- npm registry and Chrome Web Store publication are not part of this delivery and have not been performed.
