# pdfpal desktop alpha

The Windows M1 alpha adds a system tray and desktop lifecycle to the [M0 runtime proof](../docs/windows-m0-results.md). The implementation plan is in [Windows desktop plan](../docs/windows-desktop-plan.md).

## Run the alpha

Extract the entire unsigned application artifact and run `pdfpal Alpha.exe`. Keep its DLLs, resources, and other files together. The signed installer is a later milestone.

The normal application uses `%USERPROFILE%\.pdfpal`, matching the native Windows CLI. `PDFPAL_DATA_DIR`, `PDFPAL_DB`, `PDFPAL_PORT`, provider executable overrides, and the existing configuration file keep their CLI meanings. Windows and WSL have different home directories and therefore different default libraries; concurrent Windows/WSL access to the same SQLite file through a network path is not part of this alpha's validation.

Closing the window hides it to the tray. Click the tray icon to reopen; its menu includes Open pdfpal, Open in browser, AI settings, Start with Windows, Retry service, and Quit. An active answer continues while hidden, and Quit offers to keep running or cancel requests. A second launch focuses the existing window. If the tray is unavailable, closing the window offers normal quit behavior instead.

Explicit Quit first flushes pending note saves and reading progress. A failed note save offers to keep editing or explicitly quit without saving. Windows session shutdown uses a bounded flush and cancellation path.

AI settings selects an installed assistant and persists the default in the shared configuration. The reader's assistant selector also persists through a narrow desktop bridge. Existing browser selections stay local to that browser. Environment overrides remain authoritative; clear `PDFPAL_AGENT` if you want the UI to change the configured default. Guided installation and login are in M2.

Window bounds, maximized state, last route, and the one-time tray notice are stored separately in `%APPDATA%\pdfpal-desktop\desktop.json`. Start with Windows is optional and uses Windows' login registration with the selected library/port arguments. An unpacked alpha must remain in its folder for that registration to work; turn it off before moving or removing the folder.

If another updated CLI server owns the library, the app offers its validated browser URL or Retry. It does not adopt or stop that server. An unrelated occupied port produces an error and Retry. Exit old M0 builds before testing M1; they predate the ownership protocol.

## Build and test on Windows

From the source checkout, with Node.js 22 or newer:

```powershell
npm ci
node desktop/scripts/stage.mjs
./desktop/scripts/windows-m1.ps1 -SourceRoot (Get-Location).Path
```

The driver also supports UNC/WSL source checkouts, copying the generated stage onto a Windows drive before running npm or packaging. Its default build directory is `%TEMP%\pdfpal-windows-m1`. `artifacts\win-unpacked\pdfpal Alpha.exe` is the executable.

The driver installs locked dependencies, runs native process/ownership tests, compiles a deterministic test-provider executable with Windows' Framework compiler, packages the app, and exercises the actual chat HTTP route with that fixture. It repeats the packaged tests with system Node removed from PATH. Receipts exclude account identifiers, raw authentication, prompts, answers, and executable paths.

Packaged tests cover PDF import, database reopen, frontend and extension assets, actual React/preload loading, tray hide/reopen, an answer completing while hidden, authenticated extension access while hidden, persisted assistant/window/route preferences, validation of IPC arguments, second-launch focusing, backend crash recovery with saved history, and cancellation on quit.

Add `-LiveCodex` to send one fixed fixture-source question through your real local Codex account in the packaged reader. It consumes provider allowance and is never enabled in CI. The regular acceptance test uses a fake provider and must not be presented as real model inference. `-SkipInstall` supports local iteration after installing the same dependency locks.

For the smaller original runtime smoke, `windows-m0.ps1` still runs the M0 checks against the current binary. Its optional `-LiveProviders` uses real Claude/Codex connection prompts. M1 fixture mode and real-provider mode should be run separately.

## Architecture and compatibility

Electron 45.1.0 and electron-builder 26.18.0 are isolated from root npm workspaces. Installing the CLI does not install Electron. `desktop/package-lock.json` locks build tooling and `runtime-lock.json` locks the staged runtime; no native rebuild runs against the CLI's development tree.

The desktop stage uses `better-sqlite3` 13.0.3's N-API binaries and `@napi-rs/canvas` 0.1.100. The CLI retains its dependency range. PDF.js treats Electron utility processes as browsers, so the backend supplies DOM primitives and its in-process worker before loading the server. See [M0 results](../docs/windows-m0-results.md) for the original compatibility failures and their resolution.

One utility process owns the local backend and official agent child processes. The renderer is sandboxed, with Node integration off and context isolation on. Its preload can only request an allowlisted assistant change and observe assistant-change notifications; the main process validates the owning frame and app origin. HTTP/HTTPS external links open in the system browser.

Startup and migrations are serialized by a separate SQLite lease with a 15-second startup wait. Ordinary database writes retain the existing five-second busy timeout. A different lease gives one server ownership of a canonical database path and is released by the OS after process death. Private owner metadata is checked against a live challenge endpoint before offering a browser URL. Newer database schemas are rejected before migration or journal changes. Normal compatible CLI writes remain available while desktop serves the library.

Agent execution now uses the shared Windows resolver and process runner throughout chat, visual explanations, Kindle jobs, and CLI asks. It resolves native Claude/Codex executables without interpolating prompts into `.cmd` commands, hides background console windows, bounds output/time, tracks active requests, and cancels owned process trees during explicit shutdown. It preserves existing Claude/Codex/OpenCode arguments and provider billing modes.

The backend automatically retries one unexpected crash without replaying AI requests. Startup failures and repeated crashes stay actionable through the tray. Abruptly killing the entire Electron process tree, a power loss, and a fully clean nontechnical user installation remain broader release-hardening checks; the alpha does not claim to cover every forced-exit scenario.

## Validation commands

```bash
npm test
node --test desktop/test/preferences.test.mjs
npm run test:package
```

The Windows CI workflow runs the same native driver and uploads receipts plus `pdfpal-windows-m1-unsigned`. Existing Linux CI covers core coverage, reader browser tests, companion browser tests, and npm distribution. See [M1 results](../docs/windows-m1-results.md) for recorded outcomes and remaining scope.
