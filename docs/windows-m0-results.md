# Windows desktop M0 results

Date: 2026-10-29.

Status: packaged runtime proof passes; Claude live-account gate awaits renewed authentication. The complete two-provider milestone remains open until that final gate passes.

## Implemented

- An isolated Electron application with a sandboxed reader window and a managed Node utility-process backend.
- Locked Windows packaging tools and production dependencies, independent from the npm CLI installation.
- A native Windows build/test driver and a credential-free Windows CI workflow.
- Shared executable discovery, bounded process probes, conservative authentication classification, and safe provider receipts.
- Packaged smoke tests covering SQLite writes/reopen, PDF import/extraction, bundled UI/extension assets, actual React rendering, and graceful shutdown.
- A separate packaged launch with system Node absent from PATH.
- Optional live subscription tests inside the packaged backend, using a fixed prompt and retaining only status/version metadata.

## Observed evidence

| Gate | Result |
| --- | --- |
| Native Windows environment | Windows NT build 26300 x64, invoked through Windows PowerShell 5.1 from WSL |
| Packaged runtime | Electron 45.1.0 with embedded Node 24.22.1 |
| SQLite | v13.0.3 works in the isolated desktop tree; root CLI dependency retained |
| Packaged backend and UI smoke | Passed all seven checks locally and on the fresh hosted Windows CI runner, including graceful stop |
| Packaged runtime without system Node on PATH | Passed the same seven checks locally and in hosted Windows CI |
| Provider/process tests | Seven tests passed on both Linux Node and native Windows Node, including owned-descendant cleanup and preservation of an unrelated process |
| Codex subscription generation | Codex 0.164.0, ChatGPT account mode, expected answer received from inside packaged backend |
| Claude installation | Official WinGet package installed and verified as Claude Code 2.1.302 |
| Claude subscription generation | Cached account detected, then generation rejected an expired OAuth session; sign-in required |
| Existing regression suite | `npm test` passed: 109 tests before the additional process-tree test, with 88.84% line coverage; the added test also passes on both platforms |
| Existing npm distribution | `npm run test:package` passed outside the checkout, including guided pairing, fixture chat, and saved note |
| Hosted regression workflow | TypeScript/coverage, reader browser tests, Kindle extension tests, reproducible archive, and installed npm tarball checks all passed |

The executable and generated receipts are under `%TEMP%\pdfpal-windows-m0` on Windows. The unsigned executable is `artifacts\win-unpacked\pdfpal M0.exe`. Generated artifacts and private local evidence are excluded from git. The [hosted Windows feasibility run](https://github.com/andrepaim/pdfpal/actions/runs/40869854332) passed and provides both evidence receipts and the unsigned application as downloadable artifacts. The changes are reviewable in [draft PR 6](https://github.com/andrepaim/pdfpal/pull/6).

## Failures resolved during implementation

1. `better-sqlite3` v12 failed to compile against Electron 45. The desktop stage now uses v13's N-API binary without changing the root CLI dependency.
2. Top-level waiting for Electron readiness prevented startup in the ESM entry point. Initialization now starts from `app.whenReady().then(...)`.
3. PDF.js's utility-process classification skipped its Node DOM polyfills. Explicit canvas primitives and a PDF worker now support backend extraction.
4. Unconsumed smoke-test responses stalled shutdown; stale pooled sockets then failed after an intentional server restart. Responses are consumed and the restart-test requests close their connections.
5. Windows PowerShell's process wrapper did not reliably return an exit code in the initial launcher. The driver now owns a `System.Diagnostics.Process`, checks termination, and validates fresh receipts.

## Remaining gate and limits

Complete Claude's official native Windows account login and rerun the driver with `-LiveProviders`. Do not mark M0 complete on the basis of `auth status` alone. The runner will fail the live gate until it gets the expected answer.

The proof covers the current Windows host, not a pristine VM. Login/relogin user experience, crash containment after forcibly killing the parent, multiple desktop instances, installer upgrades, tray behavior, signing, and a fresh nontechnical account remain later acceptance work. The M0 harness does not promise those production behaviors.

The compatible dependency and provider versions above are observed versions, not a broad support range. Review provider conditions and repeat the version/behavior checks before public distribution.
