# Linux desktop implementation plan

Scope: ship the existing local-first reader on Linux, sharing the browser/Windows core and `~/.pdfpal` library. Desktop preferences belong in Electron's XDG configuration directory. No database format changes, production account calls, publishing, or desktop version bump are required. Debian packages are the first installer; AppImage remains deferred until its sandbox and desktop integration are validated.

## L0 — supported build environment and packaged proof

Tasks:
- Establish a task-local Node 22+ runtime without changing shell configuration; install root and isolated desktop dependencies.
- Build the shared server, frontend, extension and isolated Electron stage, preserving the native dependency boundary.
- Make packaging platform-aware: keep the Windows launcher hook working; produce a Linux directory and Debian package with proper metadata and icons.
- Add a reproducible packaged Linux acceptance driver using temporary HOME/XDG/library directories, DBus/Xvfb when available, and Chromium's normal sandbox.

Dependencies: none. Exit gate: supported Node, desktop tests and shared typecheck/build pass; native SQLite/canvas load from staged Electron; a packaged Linux application starts and serves the reader against a temporary library. Record packaging/sandbox limitations rather than bypassing them.

## L1 — useful reader, assistant discovery and lifecycle alpha

Tasks:
- Discover and probe Claude/Codex/OpenCode on Linux, including GUI PATH gaps, user installation locations and Node-dependent wrappers; preserve subprocess tool restrictions and isolated work directories.
- Replace PowerShell-specific Linux setup wording with accurate provider installation/help behavior and test mocked discovery/setup.
- Keep essential application actions accessible through a native menu and visible window; make tray absence harmless, and test close/hide/startup behavior.
- Exercise temporary-library PDF import, reader APIs and extension download. Reuse shared cloud/reader/Kindle regressions; do not claim interactive provider or clean-machine verification unless run.

Dependencies: discovery/lifecycle work can proceed independently after plan; packaged acceptance depends on L0. Exit gate: Linux discovery fixtures pass, reader and menu controls are reachable, normal close does not strand the application behind an unavailable tray, shared regressions remain green.

## L2 — protected accounts, CLI, installer and opt-in startup

Tasks:
- Audit Electron 45 asynchronous safeStorage on Linux and fail closed when secure credential storage is unavailable; use the same protected vault for ChatGPT and cloud, with platform-appropriate error text.
- Resolve desktop profiles through XDG on Linux while preserving Windows profiles and `~/.pdfpal`; retain authenticated loopback CLI transport.
- Package a Linux CLI launcher that uses Electron's embedded Node, safely quotes arguments and works without system Node. Install it without replacing independently installed npm CLI commands.
- Implement opt-in XDG autostart with safe desktop-entry argument escaping and reversible removal; preserve Windows login behavior.
- Produce and inspect a Debian package, verify installed desktop entry/launcher and packaged CLI against the temporary running app.

Dependencies: L0 packaging; CLI/profile and vault/startup tasks can run in parallel with L1. Exit gate: security-negative vault tests pass; packaged CLI status/doctor/library operations authenticate; startup defaults off and round trips safely; Debian package contents and launch behavior validated. Real Secret Service sign-in remains a manual gate if unavailable in CI.

## L3 — release safety, CI, documentation and evidence

Tasks:
- Preserve the signed Windows updater policy. Linux must never offer/download an `.exe`; document manual Debian upgrades and preserve libraries on uninstall.
- Add Linux packaged GUI acceptance under DBus/Xvfb to CI without weakening existing Windows gates; validate release/artifact metadata and generate checksums/provenance without publishing.
- Document supported desktop assumptions, installation, provider setup, secure keyring requirements, CLI coexistence, autostart, upgrade/uninstall and limitations.
- Run appropriate desktop/core/integration/package regressions, secret scanning and staged/package acceptance; record commands, outcomes and outstanding manual gates in this document or a linked results report.

Dependencies: L0–L2 implementation and acceptance. Exit gate: Linux CI/runbooks are reviewable, Windows security tests unchanged or stronger, Linux artifacts have integrity metadata, and actual test/build/package evidence is recorded. Release publication, version changes, distribution signing and external communications are excluded.

## Parallel ownership

Implementation lead owns packaging/staging, Linux acceptance, CI, release safety, documentation and integration. Provider agent owns `src/core/agents.ts`, `src/core/agent-discovery.ts`, provider fixtures/tests, and frontend assistant setup wording. Desktop platform agent owns shell lifecycle/native menus, credential vault, XDG profile/CLI integration and autostart plus their focused tests. Shared-file edits must be coordinated with the lead before integration.

## Acceptance matrix and manual gates

Automated: supported runtime; typecheck; desktop tests; shared unit/integration tests with mocked external services; full build; extension archive; staged native runtime; packaged GUI/server/PDF/CLI smoke; Debian contents; checksum verification; secret scan. Run all tests against temporary data.

Manual/environment-dependent: interactive Mint/Cinnamon and GNOME/Wayland menus/tray; real Secret Service unlock/cancel/relogin and ChatGPT/Google OAuth; installed third-party assistants; deb install/uninstall in a clean VM; sandbox behavior on distribution kernels; upgrade from a prior Linux build. These gates must be recorded honestly and do not authorize disabling the Electron sandbox.

## Implementation status (2026-11-15)

L0–L3 code, documentation and local automated acceptance are implemented. See [linux-desktop-results.md](linux-desktop-results.md) for exact outcomes, artifacts and remaining manual release gates. Packaged Mint/X11 reader/PDF/SQLite/CLI proof and real isolated Secret Service/fallback proof passed with the normal sandbox. The hosted CI job, live account/provider flows, interactive desktop variants and clean-VM installation remain explicit acceptance work before a public stable release. No version bump or publication occurred.
