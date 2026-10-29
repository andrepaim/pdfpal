# Windows desktop M3 results

Date: 2026-10-29.

Status: the installable **unsigned** preview, guarded lifecycle, branding, update-check flow, release configuration, and supporting material are implemented. A valid publisher signing identity is not configured on the current machine or in its environment, so no signed installer or public release is claimed. Fresh-account usability/provider sign-in remain manual release gates.

## Delivered preview

The desktop has its own version, initially `2.1.0-preview.1`, in `desktop/version.json`. The npm CLI stays at its existing version and does not gain Electron dependencies. The generated Windows executable is **pdfpal.exe**, with the existing pdfpal logo packaged as a multi-resolution ICO, product/version resources, an as-invoker manifest, and the stable `io.pdfpal.desktop` application ID.

The NSIS installer installs for the current user, creates a **pdfpal** Start menu entry, and offers to run the app after installation. It does not require system Node.js or administrator privileges. Application files, the regular `%USERPROFILE%\.pdfpal` library, and `%APPDATA%\pdfpal-desktop` preferences have distinct locations.

The stock install/uninstall templates are retained, with a custom running-app check replacing their process-termination behavior. The guard compares the actual executable path, including paths containing apostrophes/spaces, and never kills by name or PID. Interactive installation asks the user to quit through the tray and Retry, or cancel. Silent installation returns failure while the application is running. If Windows cannot inspect status, it fails closed. Normal Quit retains the existing active-request and pending-save handling before closing owned services.

A saved alpha project route that does not exist in the selected regular library returns to the home screen; a valid route is retained. An upgrade retains Windows-startup registration at the same installed path. A final uninstall removes that registration only if its command actually targets the installed executable. A registration targeting an older unpacked alpha is not removed blindly. Application files/shortcuts are removed; libraries and preferences are retained. Existing CLI ownership, schema guards, and migration backups remain authoritative when the next app starts.

## Updates and signing

**Check for updates** is available in the tray and startup recovery screen. The themed dialog shows the installed desktop version, preview status, available version, publisher, and release notes. It checks only after a user action, with bounded metadata size/time and useful offline/rate-limit errors. No periodic checking, automatic download, background installation, or telemetry was added.

Only stable `desktop-v…` releases from the official repository qualify. The release manifest must match the application ID, version, Windows/x64 architecture, exact installer filename, official download URL, size, SHA-256, and a signed-build declaration. Where GitHub supplies an asset digest it must match. Drafts, prereleases, npm tags, and unsigned previews are excluded. Release notes render as text. Download/notes/license actions use narrow trusted-frame IPC and fixed/verified destinations, not renderer-supplied commands or URLs. The user downloads in the browser, quits pdfpal, and runs the installer; Windows performs its normal publisher/signature checks.

The release manifest is an attestation from the project's release pipeline, not an independent client-side Authenticode verification of a downloaded file. The app does not download or execute installers itself.

Unsigned builds explicitly disable signing and omit ambient certificate links. Signed builds require the publisher plus an existing certificate link or Windows-store thumbprint, enable `forceCodeSigning`, and then verify valid timestamped Authenticode signatures on both the app and installer against the expected publisher. A signed manifest is written only after that verification. Stale manifests are removed before a new build. A bounded retry handles observed transient Windows locks while writing or starting an intermediate NSIS stub; persistent access failures remain build failures.

The manual **Signed Windows release candidate** workflow is restricted to `master` and targets the `windows-release` environment. Its environment protections and credentials still need to be configured before use. Its secrets/variable names are documented in `desktop/README.md`. It uploads a candidate for review and has read-only repository permissions; it does not create a release or publish anything. No account was opened, certificate purchased, secret committed, or self-signed certificate presented as a public publisher identity.

## Automated evidence

- 119 core tests passed with coverage thresholds.
- 12 desktop helper tests passed, including semantic version ordering, unsigned/hostile/mismatched release rejection, bounded/offline update errors, missing-signing-credential failure, isolated installer identity, preferences, sender checks, and diagnostic redaction.
- 55 reader browser tests passed, including the new manual-update dialog, explicit download, plain-text release notes, retries, setup, notes, PDF appearance, reference navigation, and restored reading position.
- 23 Kindle companion browser tests passed. The extension archive is reproducible; the npm tarball installed outside the checkout and passed guided pairing, fixture chat, and saved-note checks (362 files, about 25.6 MB).
- Existing native packaged acceptance passes after branding/version changes, including setup, background chat, pairing while hidden, crash recovery, cancellation, and graceful shutdown. The restricted-inherited-PATH run also passes; provider discovery may refresh registered PATH, so a genuinely clean no-Node machine remains a separate manual check.
- Native installer acceptance passed fresh per-user installation, product resources, Start menu target, launch from an unrelated directory, cancelled upgrade, refusal to terminate a running reader for upgrade or uninstall, graceful quit, upgrade to a new version, startup registration preservation, complete uninstall, retained preferences, and reinstall.
- An actual compiled CLI server served the same fixture library during an upgrade, stayed alive and healthy, and stopped through its normal signal handler afterward.
- SQLite integrity plus exact synthetic PDF bytes, note content, highlights, collections, answer history, and extension-client identity are checked before/after upgrade, cancellation, uninstall, and reinstall.

Installer fixtures have a separate application ID/executable/shortcut/startup name and temporary data/profile folders. Their manifest identity and installer hash are validated before installation, preventing accidental use of a production installer in the acceptance loop. Cleanup touches only the test app and processes launched by the test. The two versioned fixtures exercise installer mechanics with current code; they are not an upgrade from an earlier signed release that does not yet exist.

Initial heavily concurrent local regression runs exposed reader/companion timing failures. The full reader suite passed with two workers and the full companion suite passed on its subsequent uncontended run; no unrelated reader implementation was changed. The first preservation harness incorrectly resolved a PDF basename relative to the library instead of its `files` folder, and its uninstall check raced shortcut removal after the executable disappeared. The harness now uses the managed files folder and waits for all uninstall indicators; the native matrix then passed.

## User-facing artifacts and documentation

The production preview is `artifacts/pdfpal-Setup-2.1.0-preview.1-x64.exe`, with `pdfpal-desktop-release.json` explicitly declaring `signed: false`. The full application remains available in `artifacts/win-unpacked` for engineering diagnosis. Runtime and bundled-UI third-party notices plus pdfpal's MIT license are included; Electron/Chromium license files remain with the executable. License notices can be opened from the update dialog.

The [Windows quickstart](windows-quickstart.md) covers installation, setup, first PDF, tray behavior, update/uninstall, library locations, and a support template. Earlier alpha launchers used `%LOCALAPPDATA%\pdfpal-m0-test`, whereas the regular Start menu app uses the normal Windows CLI library. A separately supplied **Open alpha test library.cmd** can reopen that test library after installation.

A short `pdfpal-desktop-preview.webm` demonstration is generated by `desktop/scripts/record-demo.mjs` and stored under `desktop/evidence/demo` / the CI demo artifact. It is labelled as a sample PDF with a simulated assistant and does not consume personal provider allowance. It demonstrates the reader/setup journey, not a real provider connection or the native installer UI.

## Reproduce

```powershell
npm ci
node desktop/scripts/stage.mjs
./desktop/scripts/windows-m3.ps1 -SourceRoot (Get-Location).Path
```

The default local build/cache directory remains `%TEMP%\pdfpal-windows-m1`; CI supplies an isolated runner-temp directory. `-SkipInstall` reuses identical dependency locks. `-SkipPackagedChecks` is only for local installer iteration after packaged checks; CI runs the complete driver. Acceptance installers use store compression for speed; the production candidate uses normal compression.

## Remaining release gates

- Configure a real publisher signing identity and run the signed-candidate workflow. No valid signing certificate, certificate-store entry, or signing credentials were found locally; signed-build failure behavior is tested, but a real signing round trip is not claimed.
- Exercise the actual download/reputation prompt and full install/assistant download/browser login on a fresh Windows 11 user account, including fresh live Claude authentication. Automated providers are fixtures; the previous real Codex result remains separate evidence.
- Review/merge the stacked work and decide on public distribution. Nothing has been published. M4 beta usability/activation/resource measurements remain after these release gates.

Implementation references: pinned [electron-builder v26 NSIS options](https://www.electron.build/v26/docs/nsis/), [v26 Windows options](https://www.electron.build/v26/docs/win/), the installed v26 NSIS templates/signing schema, and [GitHub release metadata](https://docs.github.com/en/rest/releases/releases#list-releases). The initial update flow intentionally uses manual installer downloads rather than Electron's built-in Squirrel/MSIX updater.
