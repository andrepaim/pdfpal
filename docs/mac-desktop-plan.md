# Mac desktop build plan

Status: implemented on 2026-11-14 on the branch `feat/mac-desktop`, tested on Linux only. No part of it has run on a Mac yet; see Progress. Baseline is desktop `2.8.0-beta.1`.

## Progress (2026-11-14)

| Task | State |
| --- | --- |
| MAC-01, MAC-02, MAC-16 | Written. The build configuration validates, and a cross-package on Linux produced a correctly laid-out `pdfpal.app` (arm64 binary, launcher, icon). Ad-hoc signing, the disk image and launching the app have never run. The target is `dmg` only; the `zip` in the original task was dropped because nothing uses it. Electron 45 declares macOS 13 as the minimum. |
| MAC-03 | Written and unit-tested with an injected platform. Not run against a real Mac login shell or real assistant installs. |
| MAC-04 | Not done. It needs the MacBook. |
| MAC-10 to MAC-15, MAC-17 | Written and unit-tested. The shared code paths passed a packaged-style smoke run under Electron on Linux; the Mac branches (menu bar, Dock, title bar, login item, Applications move) have never run. |
| MAC-20 | Written. The workflow has never run. Its first run is the first real test of everything above. |
| MAC-21 | Done and unit-tested for both platforms. |
| MAC-22 | Written and unit-tested with a mocked GitHub client. The `build-mac` job has never run. Do not merge to `master` before MAC-20 passes: a failing Mac job would block Windows prereleases. |
| MAC-23 | Written. The quickstart marks the Mac build as experimental and untested on real hardware. |
| MAC-30, MAC-31 | Written and unit-tested. The launcher script was tested on Linux shells, not on macOS's `/bin/sh`. |
| MAC-40, MAC-41 | Not started. Waiting on the Apple Developer Program decision. |

Open question from MAC-22: with the Mac job required, a stable (unsuffixed) version cannot be published for Windows either until Mac signing exists. Suffixed previews are unaffected.

## Goal

Ship the existing Electron app as a Mac application: the same reader, library format, assistants and release page as Windows. The first target is an unsigned build that runs on the maintainer's MacBook Pro; a public download and signing follow in later milestones.

This is a port of the shell, not a second product. The core, server, frontend and extension are unchanged. Every difference is in `desktop/`, in assistant discovery, and in the release pipeline.

## How this fits the focus plan

[The focus plan](reader-beta-and-retrieval-plan.md) parks new work until the Windows beta has run. A Mac build is new surface area, so this plan is split so that the first milestone (M0, three code tasks) is small enough to run beside the beta steps that are waiting on people. M1 and later should start after the first Windows beta sessions, unless the maintainer decides otherwise.

## What was checked in the code

| Area | Finding |
| --- | --- |
| Native modules | No compiler is needed on the Mac. `better-sqlite3` 13.0.3 ships `prebuilds/darwin-arm64.node` and `darwin-x64.node`, and `desktop/runtime-lock.json` already locks `@napi-rs/canvas-darwin-arm64` and `-x64`. |
| Credential storage | `desktop/src/chatgpt/vault.mjs` uses Electron `safeStorage`, which uses the Keychain on a Mac. Only the error wording says "Windows". |
| Library and profile paths | The library is `~/.pdfpal` on every platform (`src/core/config.ts`). The profile uses `app.getPath('appData')`, which is `~/Library/Application Support` on a Mac. |
| Process control | `runProbe` already kills the process group on non-Windows platforms. The owner file already uses mode `0600`; `icacls` runs only on Windows. |
| Window lifecycle | `activate`, `second-instance` and `before-quit` are already handled, so closing and reopening from the Dock should work before any Mac-specific change. |
| Diagnostics | The platform allowlist already includes `darwin`. |

### Windows-only today

| Area | Where | What a Mac needs |
| --- | --- | --- |
| Packaging | `desktop/electron-builder.yml` has `win`, `nsis`, `linux: dir` and no `mac`. `build-installer.mjs` throws off Windows and hardcodes `--win --x64`, the `.exe` name and `platform: 'win32'`. | A `mac` target, a Mac icon, and a build script that takes a platform. |
| Build drivers | `desktop/scripts/windows-m0.ps1` to `windows-m4.ps1` are PowerShell. | One Node driver for install, native tests, packaging and the packaged smoke run. |
| Assistant discovery | `AgentService` uses `discoverAgent` only on Windows. Elsewhere it runs `which`, which uses the app's own `PATH`. | An app opened from Finder gets a minimal `PATH`, so Claude Code in `~/.local/bin` or Homebrew's `/opt/homebrew/bin` is not found. This is the main functional gap. |
| Assistant setup | `launchSetup` opens PowerShell with the official `install.ps1`. Off Windows it already opens the official guide. | Keep the guide for the first version; fix the wording. |
| Menus and title bar | `preload.cjs` sets `chrome: process.platform === 'win32'`; `chromeOptions` and the CSS assume window buttons on the right; `Menu.setApplicationMenu(null)` is Windows-only, so a Mac shows Electron's default menu. | A Mac application menu and a title bar that leaves room for the window buttons on the left. |
| Shortcuts | `chromeShortcut` reads `input.control`, and the UI shows `Ctrl`, `F10`, `F11`. | Command-key equivalents and matching labels. |
| Tray | A tray icon is always created from a 32 px colour PNG; closing the window hides it and shows "still running in the tray". The packaged smoke run fails without a tray. | A Dock-based lifecycle (see Decisions). |
| Start at login | `setLoginItemSettings` is called with Windows-only `name`, `path` and `args`, and is gated to Windows. The label is "Start with Windows". | The plain `openAtLogin` form and the label "Open at login". |
| CLI | `desktopProfile()` throws `WINDOWS_HOST_REQUIRED`; the launcher is a compiled C# `bin/pdfpal.exe`; `PATH` setup is done by the NSIS installer; the private channel is a Windows named pipe. | A shell launcher and profile path. The loopback transport already exists and is used when there is no pipe. |
| Update check | `desktop/src/updates.mjs` requires `platform: 'win32'`, `arch: 'x64'` and `pdfpal-Setup-<version>-x64.exe`. | A Mac would be offered the Windows installer once a stable release exists. No stable release exists yet. |
| Release pipeline | `desktop-release.mjs` publishes exactly three assets; the workflow has one Windows build job. | A Mac build job and per-platform manifests. |
| Wording | `AISettings.tsx:206`, `CommandLineSettings.tsx:15`, tray labels, `main.mjs:652`, `vault.mjs`. | Platform-neutral or Mac wording. |

## Decisions built into this plan

Each is a recommendation; change any of them before the milestone that depends on it.

1. **Apple Silicon first.** Build `arm64` only. An Intel build is a later runner and config change (`macos-15-intel`), because both native modules ship Intel binaries. Check the MacBook under Apple menu → About This Mac; if it says Intel, swap the target in MAC-01.
2. **Unsigned previews, signed stable.** Preview builds are ad-hoc signed (required for any code to run on Apple Silicon) but not notarized. A stable Mac release requires a Developer ID and notarization, mirroring the Windows rule. See M4.
3. **Dock, not menu bar.** Closing the window keeps the app in the Dock; clicking the Dock icon reopens it; Command-Q quits. No menu bar icon in the first version. The tray menu's actions move to the application menu.
4. **Same library location.** The library stays `~/.pdfpal`, shared with the npm CLI on the same Mac, as on Windows.
5. **One release, both platforms.** A version bump publishes Windows and Mac files under the same `desktop-v<version>` release, and publishes only when both builds pass. Published releases are never changed afterwards, so a Mac file cannot be added later.
6. **CLI last.** The `pdfpal` command and skill setup come after the reader works (M3). Until then the Command line settings panel already reports itself unavailable off Windows.

## Milestones and tasks

Sizes: S is contained, M spans several components, L crosses runtime or packaging boundaries.

### M0: it runs on the MacBook

Outcome: an unpacked `pdfpal.app`, built on the Mac, that opens a PDF and gets an answer from an installed assistant.

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| MAC-01 | Add a `mac` section to `desktop/electron-builder.yml` (`dmg` target, `arm64`, category, ad-hoc identity, hardened runtime off). Give `buildConfiguration` in `build-installer.mjs` a platform parameter; keep the Windows behaviour and tests unchanged. | M | — | `desktop/test` covers the Mac configuration; on the Mac, `codesign --verify --deep --strict pdfpal.app` passes. Record the minimum macOS version Electron 45 supports. |
| MAC-02 | `desktop/scripts/mac-build.mjs`: a Node driver that mirrors `windows-m0.ps1`. It installs the locked tool and stage dependencies with `--ignore-scripts`, runs `discovery.test.mjs` and `test/runtime.test.mjs`, packages with `--mac --arm64 --dir`, and runs the packaged app with `--m0-smoke`. | M | MAC-01 | A receipt with `platform: darwin`, `arch: arm64` and the same check names as the Windows receipt. Tests that cannot apply on a Mac are skipped with a stated reason, not removed. |
| MAC-03 | Assistant discovery on a Mac. (a) Resolve the login shell's `PATH` once at backend start and on "Check again", with a timeout and a marker so shell start-up output cannot corrupt it. (b) Add Mac locations to `agentCandidates`: the resolved `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`. (c) Use `discoverAgent` on `darwin` as on Windows, and pass the resolved `PATH` to the assistant process so a Node-based launcher can find `node`. | M | — | Unit tests with a fake platform, home and environment. On the Mac, an app opened from Finder lists Claude Code or Codex as installed with version and sign-in state. The tools-disabled arguments in `AgentService.run` are unchanged. |
| MAC-04 | Hands-on check on the MacBook (maintainer). | S | MAC-02, MAC-03 | The checklist below, with results written to `docs/mac-m0-results.md`. |

MAC-04 checklist: the app opens from Finder; a PDF imports from Downloads; reader, notes and highlights work; an answer arrives from Claude Code or Codex; "Continue with ChatGPT" signs in and answers; the app survives quit and reopen with the library intact; closing the window and clicking the Dock icon reopens it; the Kindle companion pairs from Chrome.

### M1: a Mac-native shell

Outcome: the app behaves like a Mac application and has no Windows wording.

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| MAC-10 | Application menu on `darwin`: pdfpal (About, AI Settings, Check for Updates, Hide, Quit), Edit (standard roles, needed for copy and paste), View (zoom, full screen), Window, Help (Send feedback, Diagnostics, licences). Items call the existing `chromeCommand` handlers. No developer-tools item in packaged builds. | M | M0 | `desktop/test/chrome.test.mjs` covers the template; copy, paste and Command-Q work in the packaged app. |
| MAC-11 | Title bar: `titleBarStyle: 'hiddenInset'` on `darwin`, the in-window chrome enabled, and a left inset for the window buttons in `desktop-chrome.css`. Preload exposes the platform so the frontend can choose labels. | M | M0 | Playwright test for the Mac layout class; a screenshot from the Mac in the results file. |
| MAC-12 | Shortcuts: `chromeShortcut` takes the platform and uses Command on a Mac; UI hints show the Mac keys. | S | MAC-11 | Unit tests for both platforms. |
| MAC-13 | Lifecycle: no tray on `darwin`; closing hides the window and keeps the Dock icon; no "running in the tray" notice; a Dock menu with Open in browser and Retry service; a bounded flush on system shutdown; the packaged smoke run no longer requires a tray on a Mac. | M | M0 | Packaged smoke receipt on a Mac includes hide, reopen, an answer completing while hidden, and graceful quit. |
| MAC-14 | "Open at login" using `openAtLogin` only, replacing the Windows-only arguments on a Mac; the selected library is read from preferences at launch. | S | MAC-13 | Toggle survives restart on the Mac; the Windows login-item test is unchanged. |
| MAC-15 | Wording: every "Windows" string that a Mac reader can see becomes neutral or Mac-specific (settings, vault errors, recovery text, CLI panel). | S | — | A test that fails if the Mac build's user-visible strings contain "Windows". |
| MAC-16 | Mac icon generated by `desktop/scripts/icons.mjs` from `frontend/public/favicon.svg`, with the margins macOS expects. | S | — | The Dock and Finder show the icon at all sizes. |
| MAC-17 | Applications-folder check: if the app is run from the disk image or Downloads, offer to move it to Applications. macOS runs such apps from a random read-only path, which breaks "Open at login" and the CLI launcher path. | S | MAC-13 | Manual check from a mounted disk image. |

Assistant install and sign-in stay as "open the official guide, then Check again" in this milestone. Opening Terminal with the official install command is a possible later task.

### M2: builds and releases from GitHub

Outcome: a version bump publishes a Mac disk image beside the Windows installer.

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| MAC-20 | `.github/workflows/mac-build.yml` on `macos-15` (Apple Silicon; free for public repositories): runs MAC-02 on pull requests that touch `desktop/**` and on manual dispatch, and uploads the disk image as a workflow artifact. It publishes nothing. | S | MAC-02 | A green run with the receipt and the `.dmg` attached. |
| MAC-21 | Update check by platform: `verifyRelease` and `checkDesktopUpdates` select the manifest and file name for the running platform and architecture. Must land before any stable release. | M | — | `desktop/test/updates.test.mjs` proves a Mac is never offered the `.exe` and Windows is never offered the `.dmg`. |
| MAC-22 | Release integration: a `build-mac` job in `windows-release.yml`; `desktop-release.mjs` accepts the Mac files and a second manifest `pdfpal-desktop-release-darwin-arm64.json`. The existing `pdfpal-desktop-release.json` keeps its name and meaning, because installed Windows apps read it. `SHA256SUMS.txt` covers every file. Release notes gain a Mac paragraph, gated by version, with the first-launch steps. | L | MAC-20, MAC-21 | `desktop/test/release.test.mjs` covers two-platform preparation, draft resume and refusal to replace; one prerelease published with both files. |
| MAC-23 | Documentation: `docs/mac-quickstart.md` (download, first launch on an unsigned build, where the library lives), plus the README, `desktop/README.md` and `CLAUDE.md`. | S | MAC-22 | Followed start to finish on the MacBook. |

### M3: command line and skill

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| MAC-30 | `desktopProfile()` and `desktop/src/cli.mjs` resolve the Mac profile path; the CLI uses the existing loopback transport with the per-run secret. | S | M1 | Unit tests; `pdfpal --desktop status` reports `loopback-http` on the Mac. |
| MAC-31 | A shell launcher in the app bundle that runs `cli.mjs` through the app's own runtime, as the Windows launcher does. The settings panel installs it as a symlink in `~/.local/bin` (no administrator prompt) and reports a conflict if another `pdfpal` comes first on `PATH`. `doctor` uses `which -a` on a Mac. | M | MAC-30 | A Mac subset of `windows-cli-check.mjs` passes against the packaged app. |

### M4: signing and notarization

This milestone starts with a decision, not code.

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| MAC-40 | Decide whether to join the Apple Developer Program (99 USD a year). [The Windows signing plan](windows-code-signing-plan.md) does not cover Apple. | S | — | Decision recorded here. |
| MAC-41 | Developer ID signing with the hardened runtime and the entitlements Electron needs; notarization and stapling in CI with credentials in a protected `mac-release` environment; stable Mac releases refuse to build without them. | L | MAC-40, MAC-22 | `spctl --assess` and `stapler validate` pass on the published disk image; a fresh Mac opens it with the normal first-launch prompt. |

## What the maintainer does on the MacBook

Needed once: Node.js 22 and git. Xcode is not needed.

```bash
git clone https://github.com/andrepaim/pdfpal && cd pdfpal
npm ci && npm run build
node desktop/scripts/stage.mjs
node desktop/scripts/mac-build.mjs      # added by MAC-02
```

An app built on the same Mac has no download flag, so it opens without the Gatekeeper prompt. The same is true for a build fetched with `gh run download`. A build downloaded with a browser is blocked until it is allowed under System Settings → Privacy & Security → Open Anyway.

The MacBook is a work machine. If it is managed by the employer, the Open Anyway option may be disabled and personal software or personal assistant accounts may be against policy. That is the maintainer's call; building locally avoids the Gatekeeper part only.

## Risks

| Risk | Effect | Response |
| --- | --- | --- |
| Finder `PATH` | Assistants show as missing although installed | MAC-03 is in M0 and is the first thing MAC-04 checks. |
| Shell start-up files are slow or print text | Discovery hangs or reads a wrong `PATH` | Timeout, marker-delimited output, fall back to the fixed Mac locations. |
| Ad-hoc identity changes with every build | The Keychain asks for the password again after each update, and saved sign-ins may need reconnecting; file-access permissions reset | Accept for previews and state it in the quickstart. MAC-41 removes it. |
| Unsigned download | Readers must use Open Anyway; some managed Macs cannot run it | Document the steps; do not call a Mac build stable before MAC-41. |
| Folder permissions | Importing by path from Documents, Downloads or Desktop can trigger a macOS permission prompt | Check in MAC-04; prefer the file picker in documentation. |
| Two build jobs gate one release | A Mac runner failure blocks a Windows release | Keep MAC-20 as a separate, non-publishing workflow until it has been green for several runs, then do MAC-22. |
| A second platform to support | Slower Windows beta | M1 onwards waits for the first beta sessions (see above). |
| The maintainer's Mac is the only test machine | Intel Macs and other macOS versions are untested | State the tested chip and macOS version in the release notes. |

## Out of scope

- Mac App Store distribution and sandboxing.
- Automatic background updates. The update check stays manual and opens the browser, as on Windows.
- An Intel or universal build, until a reader asks for one.
- A Mac version of the beta kit, the Sandbox launcher and the startup and memory measurements.
- A private Unix socket for the CLI. Loopback with the per-run secret is used first.

## Done when

- M0: the checklist in MAC-04 passes on the MacBook and is recorded.
- M1: a Mac reader sees no Windows wording, can use the menu bar and Command shortcuts, and can close and reopen the window from the Dock.
- M2: one version bump publishes both platforms, and the update check cannot offer the wrong platform's file.
- M3 and M4 are optional for a preview and required before a Mac build is called stable.
