# pdfpal Windows desktop preview

M3 adds a branded per-user Windows installer, versioned desktop releases, guarded upgrades/uninstall, manual update checking, license notices, and signing configuration to the accepted M2 desktop application. See the [Windows quickstart](../docs/windows-quickstart.md), [M3 results](../docs/windows-m3-results.md), and [implementation plan](../docs/windows-desktop-plan.md).

M4 adds repeatable engineering measurements and an offline beta field-test kit. See [M4 results](../docs/windows-m4-results.md) and the [observer guide](../docs/windows-beta-guide.md). Actual participant results, clean-account provider login, reference-machine validation and publisher signing remain release gates.

Windows downloads are published through the [GitHub Actions release pipeline](../docs/windows-release-pipeline.md): a desktop version bump merged into `master` creates a tested installer on GitHub Releases. Suffixed versions are engineering prereleases; stable releases require publisher signing. The npm CLI version remains independent.

## Install the preview

Run **pdfpal-Setup-2.1.0-preview.5-x64.exe**, then open **pdfpal** from the Start menu. Quit an earlier running pdfpal instance from its tray first. The current test candidate is unsigned; publisher signing is an explicit release gate. The installer installs for the current user without requesting administrator privileges. It keeps application files separate from the library, retains data on uninstall, and refuses to force-close a running instance.

The unpacked artifact remains available for engineering checks as `win-unpacked/pdfpal.exe`; keep the entire folder together if using it.

The normal application uses `%USERPROFILE%\.pdfpal`, matching the native Windows CLI. `PDFPAL_DATA_DIR`, `PDFPAL_DB`, `PDFPAL_PORT`, provider executable overrides, and the existing configuration file keep their CLI meanings. Windows and WSL have different home directories and therefore different default libraries; concurrent Windows/WSL access to the same SQLite file through a network path is not part of this alpha's validation.

Closing the window hides it to the tray. Click the tray icon to reopen; its menu includes Open pdfpal, Open in browser, AI settings, Start with Windows, Check for updates, Diagnostics, Retry service, and Quit. An active answer continues while hidden, and Quit offers to keep running or cancel requests. A second launch focuses the existing window. If the tray is unavailable, closing the window offers normal quit behavior instead.

Explicit Quit first flushes pending note saves and reading progress. A failed note save offers to keep editing or explicitly quit without saving. Windows session shutdown uses a bounded flush and cancellation path.

AI settings opens a themed in-app dialog with installed assistants, account/billing status, refresh, and inline save errors. It persists the default in the shared configuration. The reader's assistant selector also persists through a narrow desktop bridge. Existing browser selections stay local to that browser. Environment overrides remain authoritative; clear `PDFPAL_AGENT` if you want the UI to change the configured default. First launch offers guided installation/sign-in, optional connection testing, and Continue without AI. Tests use provider allowance only after an explicit action, with an additional acknowledgement for separate billing modes. See [M2 results](../docs/windows-m2-results.md) for behavior, security review, evidence, and remaining manual gates.

Window bounds, maximized state, last route, and the one-time tray notice are stored separately in `%APPDATA%\pdfpal-desktop\desktop.json`. Start with Windows is optional and uses Windows' login registration with the selected library/port arguments. An unpacked alpha must remain in its folder for that registration to work; turn it off before moving or removing the folder.

If another updated CLI server owns the library, the app offers its validated browser URL or Retry. It does not adopt or stop that server. An unrelated occupied port produces an error and Retry. Exit old M0 builds before using the current desktop; they predate the ownership protocol.

## Build and test on Windows

From the source checkout, with Node.js 22 or newer:

```powershell
npm ci
node desktop/scripts/stage.mjs
./desktop/scripts/windows-m3.ps1 -SourceRoot (Get-Location).Path
```

The driver also supports UNC/WSL source checkouts, copying the generated stage onto a Windows drive before running npm or packaging. Its default build directory is `%TEMP%\pdfpal-windows-m1`. `artifacts\pdfpal-Setup-2.1.0-preview.5-x64.exe` is the installer and `artifacts\win-unpacked\pdfpal.exe` is its application.

The shared open-book icon is defined in `frontend/public/favicon.svg`. After installing root dependencies, run `node desktop/scripts/icons.mjs` to regenerate the browser and companion PNGs, logo, browser ICO, and Windows ICO. Each target size is rendered directly from the vector source; the Windows ICO retains native bitmap frames for small shell and installer icons. The companion build copies the same PNGs from the web app.

The driver installs locked dependencies, runs native process/ownership and setup-state tests, compiles a deterministic test-provider executable with Windows' Framework compiler, packages the app, and exercises the actual chat HTTP route with that fixture. It repeats the packaged tests with Node removed from the inherited PATH. Discovery can refresh registered Windows PATH entries; a genuinely clean machine without Node remains a manual acceptance check. Provider launches resolve native executables rather than npm shell wrappers. Receipts exclude account identifiers, raw authentication, prompts, answers, and executable paths.

Packaged tests cover first-launch setup, explicit connection verification/cancellation, persisted completion, a local startup-recovery screen with retry, redacted diagnostics, PDF import, database reopen, frontend and extension assets, actual React/preload loading, tray hide/reopen, an answer completing while hidden, authenticated extension access while hidden, persisted assistant/window/route preferences, validation of IPC arguments, second-launch focusing, backend crash recovery with saved history, and cancellation on quit.

The smaller `windows-m2.ps1` driver accepts `-LiveCodex` to send one fixed fixture-source question through your real local Codex account in the packaged reader. It consumes provider allowance and is never enabled in CI. The regular acceptance test uses a fake provider and must not be presented as real model inference. `-SkipInstall` supports local iteration after installing the same dependency locks.

For the smaller original runtime smoke, `windows-m0.ps1` still runs the M0 checks against the current binary. Its optional `-LiveProviders` uses real Claude/Codex connection prompts. Fixture mode and real-provider mode should be run separately.

## Installer and release checks

The M3 driver first runs packaged acceptance, builds the production preview, then makes two isolated unsigned installer fixtures for upgrade testing. The fixtures use their own app ID, executable, Start menu entry, startup registration, and temporary library. A fixture manifest/hash check prevents accidentally passing a production installer into the destructive installer acceptance loop.

The native matrix covers fresh per-user install, application resources, Start menu target, launch from an unrelated directory, cancelled upgrade, refusal to close a running app, graceful quit, upgrade while a real CLI server keeps serving the same library, startup-preference preservation, version change, uninstall, and reinstall. SQLite integrity and exact fixture PDF/note/highlight/collection/history/extension-identity snapshots are checked throughout. No normal installation or personal library is installed over or removed by this test.

`build-installer.mjs` uses the pinned v26 builder options. Unsigned mode explicitly disables signing and ignores ambient certificate links. Signed mode requires `PDFPAL_PUBLISHER_NAME` plus `CSC_LINK`/`WIN_CSC_LINK`, or a Windows-store `PDFPAL_CERTIFICATE_SHA1`. It enables `forceCodeSigning` and verifies the application and installer have valid, timestamped Authenticode signatures from the expected publisher before writing a signed release manifest. Failed builds remove stale release metadata. No private key is written into build configuration.

The **Signed Windows release candidate** workflow is manual, limited to `master`, and targets the `windows-release` environment. Configure that environment’s credential-access protections, publisher variable and `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD` secrets there; do not commit certificates or paste credentials into an issue. It uploads a reviewable candidate and test receipt. It does not publish releases. Windows-store signing is also available for a local build with an existing signing provider/certificate.

Desktop versions live in `desktop/version.json`, independently of the npm CLI version. An explicit `PDFPAL_DESKTOP_VERSION` build override must be a valid version. The initial update flow checks only when requested, reads stable `desktop-v…` releases from the official repository, and requires the matching application ID, signed-manifest flag, platform/architecture, filename, size, SHA-256, and official download URL. Downloads open in the browser; installation is user-initiated. Unsigned previews and npm releases are not offered as updates.

Use `-SkipInstall` only after installing the same dependency locks. `-SkipPackagedChecks` exists for local installer iteration after packaged acceptance; CI runs the full driver. Acceptance fixtures use store compression for speed, while the production candidate uses normal compression. The two fixture versions use the current code and exercise installer/data-preservation mechanics; they are not proof of an upgrade from a historical signed release that does not yet exist.

A deterministic, labelled reader demo can be recorded with `node desktop/scripts/record-demo.mjs` after building and installing the Playwright browser. It uses a sample PDF and simulated assistant, without a personal account or provider usage. CI saves the video as a separate artifact.

## Beta engineering and field-test kit

After staging, run `windows-m4.ps1 -SourceRoot <checkout>` under native Windows for 20 fresh process launches, a 60-second tray-idle measurement, and 50 background-answer/reopen/second-launch/graceful-quit cycles. It builds a separate unsigned acceptance executable, library and profile. Measurements distinguish private working set, total working set and private committed bytes, and normalize CPU by machine capacity. The normal production build cannot enable the internal file-control harness.

After the M3 installer build, run `node desktop/scripts/create-beta-kit.mjs <artifacts> <local-Windows-kit-folder>`. It verifies installer identity/bytes and includes an offline observer recorder and a Sandbox launcher that regenerates host mappings after moves. Testers need neither Node.js nor terminal commands. Aggregate collected anonymous reports with `node desktop/scripts/beta-report.mjs <results-folder>`. Invitations, real account sign-in, signing credentials and publication are separate maintainer actions. The kit never treats empty or simulated data as participant acceptance.

## Architecture and compatibility

Electron 45.1.0 and electron-builder 26.18.0 are isolated from root npm workspaces. Installing the CLI does not install Electron. `desktop/package-lock.json` locks build tooling and `runtime-lock.json` locks the staged runtime; no native rebuild runs against the CLI's development tree.

The desktop stage uses `better-sqlite3` 13.0.3's N-API binaries and `@napi-rs/canvas` 0.1.100. The CLI retains its dependency range. PDF.js treats Electron utility processes as browsers, so the backend supplies DOM primitives and its in-process worker before loading the server. See [M0 results](../docs/windows-m0-results.md) for the original compatibility failures and their resolution.

One utility process owns the local backend and official agent child processes. The renderer is sandboxed, with Node integration off and context isolation on. Its preload exposes narrow, allowlisted setup, preferences, recovery, and diagnostic actions; the main process validates the owning top-level frame and app origin. The exact bundled recovery file gets only recovery privileges. Installer/login commands use verified executable paths and fixed official URLs; document or renderer text cannot become a command. HTTP/HTTPS external links open in the system browser.

Startup and migrations are serialized by a separate SQLite lease with a 15-second startup wait. Ordinary database writes retain the existing five-second busy timeout. A different lease gives one server ownership of a canonical database path and is released by the OS after process death. Private owner metadata is checked against a live challenge endpoint before offering a browser URL. Newer database schemas are rejected before migration or journal changes. Normal compatible CLI writes remain available while desktop serves the library.

Agent execution now uses the shared Windows resolver and process runner throughout chat, visual explanations, Kindle jobs, and CLI asks. It resolves native Claude/Codex executables without interpolating prompts into `.cmd` commands, hides background console windows, bounds output/time, tracks active requests, and cancels owned process trees during explicit shutdown. Claude calls disable built-in/MCP tools. Codex calls retain the read-only sandbox, disable shell/web tools, use ephemeral sessions, and ignore unrelated user config/rules while retaining authentication. Custom Codex configuration-based providers are not inherited by these isolated reading calls. Unsupported capabilities produce update guidance. Existing OpenCode support remains available.

The backend automatically retries one unexpected crash without replaying AI requests. Startup failures use a local themed recovery page. Repeated crashes offer Retry in the reader and tray. When the service returns on the same origin, the existing reading view and drafts stay mounted. Diagnostics are previewed before export and contain only allowlisted metadata and a bounded event log. Abruptly killing the entire Electron process tree, a power loss, and a fully clean nontechnical user installation remain broader release-hardening checks; the alpha does not claim to cover every forced-exit scenario.

## Validation commands

```bash
npm test
node --test desktop/test/preferences.test.mjs desktop/test/setup.test.mjs desktop/test/updates.test.mjs desktop/test/beta.test.mjs
npm run test:package
```

The Windows CI workflow runs the same native driver and uploads receipts plus `pdfpal-windows-m3-installer-unsigned` and `pdfpal-windows-m3-unpacked-unsigned`. Existing Linux CI covers core coverage, reader browser tests, companion browser tests, and npm distribution. See [M3 results](../docs/windows-m3-results.md) for recorded outcomes and remaining release gates.
