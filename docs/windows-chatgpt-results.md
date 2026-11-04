# Windows ChatGPT mode implementation

Date: 2026-11-04. Candidate version: 2.2.0-preview.1. The GitHub preview is built and validated from the release commit by the Windows publication workflow. Local engineering-build evidence is recorded below.

The Windows desktop app now offers a direct ChatGPT connection using eligible plan allowance. A coding-agent executable is not needed for this mode. Existing Claude Code, Codex and OpenCode adapters remain selectable. The implementation follows [the plan](windows-chatgpt-plan.md), with the staged limits below.

## Delivered

- A shared AI service routes PDF/project chat, Kindle questions and visual generation to either an installed agent or the direct desktop provider. Explicit provider selection and existing command-line configuration remain authoritative. Standalone CLI library commands work independently; direct headless AI requests return desktop setup guidance.
- Native browser sign-in uses PKCE, state, nonce, an issued client registration and verified identity. Windows main owns OAuth, model discovery and Responses transport. Credentials are encrypted using Electron safeStorage/DPAPI, outside the document database, and are not returned through the renderer bridge. Host and registration records persist for reuse.
- AI settings support connecting, saved account selection, available model selection, reconnect, adding another registration, cancellation, disconnect/revocation and usage management. Model responses stay attached to their original registration even when the active account changes.
- Responses use the documented public endpoint, supported request fields and a required terminal completion event. Partial text streams through the private backend channel. Schema-validated visuals use the existing renderer.
- Schema 10 adds durable AI job records. Direct text checkpoints survive failed requests; restarting the desktop-owned server marks stale jobs interrupted. PDF/project chat offers saved incomplete work for explicit reuse. Existing final chats/visuals and migration backups remain intact.
- Active direct requests participate in desktop work accounting and shutdown. The current Stop control explicitly stops ChatGPT answers for the account; individual request cancellation across simultaneous windows remains a refinement.

## TDD and automated results

Failing tests were recorded before the protocol/provider implementation, session module, mode preference helper, durable job integration and account model-list race fix. Local logs include `/tmp/pdfpal-win-chatgpt-red.log`, `session-red.log`, `mode-red.log`, `jobs-red.log`, `account-race-red.log` (all with the same `pdfpal-win-` prefix), and `/tmp/pdfpal-win-ui-red.log`.

Final regression results before packaging:

| Suite | Result |
| --- | --- |
| Core, server, CLI and migration tests | 126 passed; required coverage checks passed |
| Desktop tests including sign-in callback, refresh serialization and protected-storage failure | 33 passed |
| Reader browser tests including ChatGPT settings | 59 passed |
| Kindle extension browser tests | 23 passed |
| Additional direct-provider route/checkpoint checks after checkpoint throttling | 2 passed |
| Root production build and TypeScript | Passed |
| Native Windows unpacked app smoke | 7 checks passed on Electron 45.1.0 / Node 24.22.1; actual PDF extraction, SQLite reopen, frontend and graceful shutdown |

A migration fixture needed its historical version markers updated to represent an actual version-8 database after schema 10 was introduced. The preserved source/note/connection/visual assertions remain enabled. A missing-model request initially surfaced the wrong setup message; the session now checks connection state first. A model response initially followed the active account after an asynchronous switch; a failing race test led to binding the original registration.

A second selection test covered an existing `pdfpal.agent=claude` browser preference: choosing ChatGPT now updates it, so opening a reader cannot silently retain the old CLI choice. The regression failed before the fix and passed afterward. A temporary browser-test server needed restarting after rebuilding hashed frontend assets; this was a test harness issue.

An additional failing browser test exposed first-run setup not being marked complete when choosing ChatGPT; the Use ChatGPT action now completes onboarding, and all four settings tests pass.

The unsigned PowerShell build harness was rejected by Windows execution policy. Packaging used the native Windows Node driver `desktop/scripts/windows-chatgpt-check.mjs`; no policy or verifier settings were changed. Third-party notices and the runtime lock include the pinned JOSE dependency.

## Native and real-account evidence

An isolated Windows preview uses a temporary library and persistent test profile under `%LOCALAPPDATA%\Temp\pdfpal-windows-chatgpt`. The user's normal Windows library was not selected for these tests. Windows created an encrypted credential record before sign-in. The user then confirmed “Connected and models appear” after authorizing pdfpal's own browser connection.

A real direct request completed on the public *Attention Is All You Need* PDF: why shifting decoder inputs remains necessary despite causal masking. The 938-character saved answer included a three-position cats/sleep/EOS example, the current-position information leak, residual connections and citations. No coding-agent invocation was involved. A separate live visual request completed with three schema-valid scenes, titled “Why attention divides by √d_k”, using the paper’s page-4 scaling passage. It is saved under the same PDF source, separately from the decoder question.

Local receipts and real outputs live in the ignored Windows temporary work directory and `/tmp/pdfpal-win-*.log`; they are not credential fixtures. Do not commit encrypted account records, authorization URLs or private diagnostics.

## Remaining acceptance and refinements

Real-account text and visual inference passed. The final candidate was restarted using the same isolated Windows profile: the protected connection reopened with 8 models, all 4 saved chat messages remained, and the three-scene visual loaded as complete. No second authorization was required. Installer assembly succeeded and the locally packaged artifact has a SHA-256 manifest in `desktop/artifacts`. The first compressed installer attempt exceeded its wrapper timeout. The completed engineering installer uses store compression for predictable local assembly; it is larger (about 511 MiB) than a distribution build. Its final source includes the later context-bound and onboarding fixes.

A clean Windows account with no prior agent installation, full install/upgrade UI acceptance, per-request cancellation across multiple simultaneous readers, request-level account/model provenance in durable history, and a broader auth/error fixture matrix remain release-hardening work. The current implementation does not claim those checks passed. A CLI used against an upgraded schema-10 library must also come from this updated checkout; older binaries are rejected by the existing newer-schema guard.

The two reference applications remain separate clients/hosts; no mobile/distillpod/agent credentials were imported. The newly added mode is a locally tested engineering preview, not a signed stable release. Installer: `desktop/artifacts/pdfpal-Setup-2.2.0-preview.1-x64.exe`; checksums and source/base-commit disclosure: `chatgpt-preview-manifest.json` and `chatgpt-preview-SHA256SUMS` alongside it. The running isolated preview is the reviewed final candidate and retains the authenticated test profile. Its second restart again recovered the connected session, 8 models, 4 chat messages and the saved visual. The installer includes the saved-provider-selection fix.
