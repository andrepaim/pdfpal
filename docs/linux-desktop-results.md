# Linux desktop implementation and acceptance

Implemented on 2026-11-15 from `51b60d5d00d693b073c6c48b167a10cc776b0ec3`, with reviewable uncommitted changes. The desktop version remains `2.8.0-beta.4`; nothing was published and no release trigger was changed. The local Debian artifact is an unsigned engineering preview, not a claim of stable-release readiness.

## Milestone outcomes

| Milestone | Delivered | Acceptance status |
| --- | --- | --- |
| L0 | Supported task-local Node, complete shared build, isolated Electron stage, Linux directory/deb packaging, generated native icons, packaged reader/PDF/SQLite proof | Passed locally on Mint 22.3 / X11 with Electron 45.1.0 and its embedded Node 24.22.1, normal sandbox enabled |
| L1 | Native menus for essential controls, tray-independent Linux quit/visible startup, portable Claude/Codex/OpenCode discovery/capability probes, GUI PATH and Node wrappers, accurate manual Linux setup | Provider fixtures, reader/browser, lifecycle/menu unit tests and actual GIO argument parsing passed; live providers and interactive desktop variants remain manual |
| L2 | Fail-closed async credential vault, persist-before-connect OAuth state, shared XDG profiles, bundled CLI using Electron Node, npm command coexistence, opt-in managed XDG autostart, Debian installer | Real private-DBus synthetic keyring round trip and relaunch passed; insecure async fallback rejected; default-XDG authenticated CLI and extracted Debian acceptance passed |
| L3 | Linux CI job, preserved Windows updater trust, manual Linux upgrades, Debian identity/checksum/source provenance, installation/security/runbook documentation | Local regressions and package verification passed; hosted Ubuntu CI and Windows installer execution were not run from this Linux session |

## Changes and boundaries

The packaged Linux GUI is `pdfpal-desktop`; its independent CLI is `pdfpal-desktop-cli`. The installer retains the default shared `~/.pdfpal` library and uses XDG desktop configuration separately. It never replaces npm's `pdfpal` command. Linux closes through the existing save/quit path, and hidden login startup cannot depend on a tray icon being visible. Startup remains explicitly opt-in and refuses to overwrite/remove unmanaged entries or symlinks.

The asynchronous Electron Linux availability API alone is insufficient: actual isolated Electron 45 testing returned `true` both for Secret Service (`v11`) and its hardcoded basic fallback (`v10`). The vault verifies protected asynchronous ciphertext before saving or reading credentials. The proof used a temporary home/XDG tree, private DBus and synthetic GNOME Keyring, with no personal credentials. Secure encrypted credentials survived a second Electron process. Basic fallback could neither write credentials nor read/overwrite the secure file. ChatGPT becomes connected only after its protected write succeeds.

The Debian builder extends the pinned electron-builder install/remove templates, preserving GUI registration, sandbox permissions and Ubuntu AppArmor integration. The Linux CI job uses path-scoped AppArmor user-namespace permission and keeps the renderer sandbox enabled. No `--no-sandbox` workaround or system-wide sandbox relaxation was added.

Linux update checks never consult or offer Windows assets. The existing signed stable Windows release verifier remains covered by its tests. Linux integrity metadata validates the actual Debian package name/version/architecture and explicitly marks manual, unsigned distribution and whether source changes were uncommitted. Checksums are integrity evidence, not publisher authentication.

## Recorded automated verification

All data-changing tests used temporary library/profile directories. External providers and account APIs were mocked; GUI tests explicitly select nonexistent unused providers so discovery cannot probe installed accounts.

| Check | Result |
| --- | --- |
| Root typecheck and full server/frontend/extension build | Passed on Node 22.23.5, downloaded into `/tmp/pdfpal-linux-tooling` with official SHA-256 verification |
| `npm test` with coverage | 234 tests: 233 passed, 1 emulator-dependent skip, 0 failures; 86.29% lines/statements, 82.78% branches, 94.44% functions |
| `npm --prefix desktop test` | 64 passed, including Windows updater/behavior compatibility, vault refusal/migration and OAuth persistence ordering |
| Staged discovery/native runtime suite | 12 passed; real staged SQLite ownership/port/reopen behavior |
| Shared profile tests | 2 passed, covering XDG defaults, relative-XDG rejection, overrides, Windows and preview profiles |
| Frontend Playwright | 103 passed, including 8 desktop setup tests with Linux help/terminal wording |
| Extension Playwright | 23 passed, including delayed answers, expired auth, pairing/revocation, restart recovery, saved notes, visuals and offline export |
| npm tarball smoke outside checkout | Passed: installed tarball, dictionary/assets, guided pairing, mocked Codex chat and saved note |
| Extension reproducible archive verification | Passed |
| Packaged Linux GUI/CLI acceptance | Passed: mounted reader, HTTP, actual PDF import/extraction, SQLite persistence, graceful stop, normal app startup, default XDG profile, authenticated loopback CLI and CLI PATH without Node |
| Real isolated Electron secure-storage proof | Passed: protected vault round trip/relaunch and insecure fallback refusal |
| Extracted Debian acceptance | Passed: real control metadata, installed layout, desktop-file validation, composed upstream hooks, CLI help without system Node; package not installed on host |
| Credential scan and whitespace/diff checks | Passed |

The packaged acceptance receipts are `desktop/evidence/linux-acceptance.json`, `linux-keyring.json` and `linux-deb.json`. They are ignored local artifacts; CI uploads them alongside the Debian package. Detailed local logs are under `/tmp/pdfpal-linux-tooling/`.

## Reviewable artifacts and reproduction

- Debian package: `desktop/artifacts/pdfpal-2.8.0-beta.4-amd64.deb`.
- Unpacked application: `desktop/artifacts/linux-unpacked/pdfpal-desktop`.
- Integrity/provenance: `desktop/artifacts/pdfpal-linux-release.json` and `SHA256SUMS-linux.txt`.
- Implementation plan: [linux-desktop-plan.md](linux-desktop-plan.md).
- Build, install, upgrade, account protection and acceptance commands: [linux-quickstart.md](linux-quickstart.md).

The manifest records the base source commit and `sourceDirty: true` for this local implementation. Artifacts were not committed, published, installed into the host OS or sent elsewhere.

## Remaining manual release gates

1. Real Google/ChatGPT OAuth and account eligibility; interactive keyring unlock, cancellation, lock/relogin and recovery on each supported desktop.
2. Actual installed Claude/Codex/OpenCode sign-in and generation with eligible provider accounts.
3. Interactive Mint/Cinnamon and GNOME/Wayland menus, accelerators, display scaling and tray variations. Automated menu/control/lifecycle tests do not replace this.
4. Clean-machine Debian install, package upgrade/removal and preservation of pre-existing npm CLI/library/configuration; apt dependency resolution and distribution sandbox policy.
5. Execute the new hosted Ubuntu packaged/keyring CI job and existing native Windows installer gates before release.

AppImage, non-x86-64 packaging acceptance, distribution signing and automatic Linux updates remain deferred. The implementation does not imply those release gates are complete.

Final local Debian fingerprint: 161,183,488 bytes; SHA-256 `acc9d4b40a417d3d380b49064dde25c5aa44b1ea780dad5ed83b91fe1a74b1a9`. Both checksum entries verified after the final rebuild. The eight packaged desktop modules were compared against current source, allowing only the staging script's expected relative-import rewrite in the ChatGPT session module. Final packaged GUI/CLI and extracted-Debian acceptance passed after that rebuild; no acceptance app, private keyring daemon, provider fixture or browser test process remained running.
