# Windows desktop feasibility build

This is the M0 engineering build for the [Windows desktop plan](../docs/windows-desktop-plan.md). It packages the existing reader and backend in Electron and exercises the runtime boundaries before adding the setup assistant, tray, and installer.

The tooling is deliberately outside the root npm workspace. Installing the CLI does not install Electron. Desktop production dependencies are staged independently; the ordinary Node native module remains untouched.

## Build and test on Windows

Build the existing application first, using Node.js 22 or newer:

```powershell
npm ci
node desktop/scripts/stage.mjs
./desktop/scripts/windows-m0.ps1 -SourceRoot (Get-Location).Path
```

The PowerShell runner also accepts a UNC source checkout, including a WSL checkout. It copies the generated stage onto a Windows drive before invoking npm and electron-builder. Its default build directory is `$env:TEMP\pdfpal-windows-m0`.

The runner installs locked build tooling and runtime dependencies, runs the provider/process unit tests under native Windows Node, packages an unsigned Windows x64 directory, and launches the packaged executable twice. The second launch removes system Node.js from PATH. Both runs use fresh disposable libraries and verify:

- HTTP startup and project creation in SQLite.
- PDF fixture upload and text/page extraction in the utility process.
- Bundled extension metadata and frontend JavaScript availability.
- Database close, reopen, and persistence.
- Actual React reader mounting inside a sandboxed Electron window.
- Graceful backend exit and removal of the disposable library.

Evidence is written to `packaged-receipt.json` and `no-system-node-receipt.json` in the build directory. A failure exits nonzero; a receipt is emitted only after backend shutdown. CI runs the same driver without personal account credentials.

To additionally test real subscription-backed answers inside the packaged utility process:

```powershell
./desktop/scripts/windows-m0.ps1 -SourceRoot (Get-Location).Path -LiveProviders
```

This sends one fixed connection prompt through each installed, account-authenticated agent and consumes the user's provider allowance. API and external-provider modes are diagnosed but do not silently incur usage. A failed or missing live provider gate exits nonzero and is recorded in the receipt. Raw authentication output, answers, executable paths, and account identifiers are excluded from receipts.

`-SkipInstall` is available for local iteration after dependencies have already been installed from the same lockfiles. CI should always install dependencies.

For passive discovery from the source checkout after `npm run build:server`:

```powershell
node desktop/scripts/check-providers.mjs
```

For a user-requested connection test of one provider only:

```powershell
node desktop/scripts/check-providers.mjs --live --agent=claude
node desktop/scripts/check-providers.mjs --live --agent=codex
```

These standalone diagnostics require Node.js. The packaged application uses its embedded runtime.

## Runtime decisions proved by M0

Electron is pinned to 45.1.0 and electron-builder to 26.18.0. Build tools have their own `package-lock.json`; `runtime-lock.json` locks the staged production tree. Changing the root runtime dependencies requires regenerating and reviewing the runtime lock against the stage's generated `package.json`.

The desktop uses `better-sqlite3` 13.0.3, whose N-API Windows binaries work with the embedded runtime. The CLI remains on its existing dependency range. The first Windows experiment with v12.11.1 failed to compile against Electron 45's V8 API. See the upstream [v13 release description](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0). Native rebuilds and install scripts are disabled in the isolated stage because the selected runtime packages include their native binaries.

PDF.js treats Electron utility processes as browsers. The backend explicitly supplies the DOM primitives from `@napi-rs/canvas` 0.1.100 and an in-process PDF.js worker before loading the server. This allows extraction without a browser DOM or browser Worker in that process. The reader still uses its normal browser PDF worker.

The main process waits asynchronously for Electron readiness and receives the exact backend origin through a private message channel. It does not trust a health response from an arbitrary occupied port. The renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. External windows and navigation away from the owned origin are blocked in this engineering build.

## Provider compatibility

| Provider | Installation and discovery | Account check | Answer invocation used by the proof |
| --- | --- | --- | --- |
| Claude Code | Explicit executable, PATH executables, native `.local/bin` fallback; exclude Claude Desktop's WindowsApps alias. Official WinGet package `Anthropic.ClaudeCode` tested. | `claude auth status`, with unknown JSON/modes preserved as unknown | `--print --tools ""`, fixed prompt on stdin |
| Codex | Explicit executable, native PATH candidate, native `.local/bin` fallback, npm package's vendor binary. No `.cmd` shell interpolation or system Node required for native invocation. | `codex login status`, conservative recognition of account/API/signed-out messages | `--ask-for-approval never exec --skip-git-repo-check --sandbox read-only -`, fixed prompt on stdin |

Claude Code 2.1.302 and Codex 0.164.0 were detected under native Windows during M0. A cached Claude account status initially reported a login, but inference failed because its OAuth session had expired. The harness distinguishes this from a successful connection. Authenticate through `claude auth login`; do not copy credentials between Windows and WSL.

Provider installation and authentication references: [Claude setup](https://code.claude.com/docs/en/setup), [Claude command reference](https://code.claude.com/docs/en/cli-reference), [Claude integration conditions](https://code.claude.com/docs/en/legal-and-compliance), [Codex CLI](https://learn.chatgpt.com/docs/cli), and [Codex authentication](https://learn.chatgpt.com/docs/auth). This integration runs official binaries under the user's identity. It does not provide its own OAuth implementation or intermediate subscription credentials.

## What follows this proof

The executable in `artifacts/win-unpacked/pdfpal M0.exe` is an unsigned engineering artifact. Launching it normally opens the existing reader against the configured local library; closing its window exits this M0 build. The production tray, single-instance behavior, server/library ownership coordination, setup wizard, installer, signing, and updates belong to the following milestones.

The proof tests a native Windows developer machine, including a restricted-PATH run. That establishes independence from a system Node executable at runtime; it does not replace clean Windows user/VM installer acceptance, provider login usability, full process-crash containment, or the later cross-interface regression matrix.
