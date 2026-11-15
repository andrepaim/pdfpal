# Shared desktop menu on Linux

## Goal and boundaries

Give Linux the same compact pdfpal menu, reading history and project finder as Windows. Keep the Linux window manager's frame, title bar and window controls. Keep Windows' existing native caption overlay. Browser readers and unsupported platforms keep their existing layout. This work changes source and tests only: no release version, installation, sign-in, personal library or cloud data changes.

## Design

Expose separate `sharedMenu` and `titleBarOverlay` desktop capabilities through the sandboxed preload bridge. The main process owns the platform decision; the frontend does not infer it from a user agent. Linux and Windows enable the shared menu, and only Windows enables the caption overlay. Retain the legacy `chrome` bridge flag for older callers.

Use a full-width 44px toolbar within Linux's native frame, with no reserved Windows caption space or synthetic window buttons. Apply caption-area CSS and dragging only to Windows. Suppress the traditional native menu once the local reader has loaded; preserve the Linux native recovery menu while the backend is starting or unavailable. Reuse fixed, validated chrome commands and existing panel/diagnostics/license APIs. Preserve native editing shortcuts and Linux startup preferences.

Electron documents that `Menu.setApplicationMenu(null)` removes the window menu bar on Windows and Linux: https://www.electronjs.org/docs/latest/api/menu#menusetapplicationmenumenu. Its custom-title-bar guide describes overlay controls: https://www.electronjs.org/docs/latest/tutorial/custom-title-bar. Linux does not need an overlay or frameless rewrite to share the app menu.

## Tasks and dependencies

1. **Platform contract and shell integration.** Add capability policy, preload values, and cross-platform shortcut handling. Switch native menu ownership when entering/leaving the reader; retain recovery commands. Depends on nothing.
2. **Shared frontend and layout.** Use the explicit capability contract, retain legacy Windows compatibility, split native-frame/overlay layout, and expose remaining native menu actions (diagnostics, licenses, startup). Depends on the agreed capability contract; can proceed alongside task 1.
3. **Behavioral regression coverage.** Exercise Linux/Windows capabilities, native recovery and shortcut policy, project navigation, menu keyboard focus/dismissal, bridge actions, layout, and absent/disabled bridge. Depends on tasks 1–2 interfaces; test preparation can proceed in parallel.
4. **Validation and evidence.** Run typecheck, desktop tests, core tests, frontend/extension browser checks, archive/package checks, and real sandboxed Linux smoke with temporary profiles where tooling permits. Inspect toolbar/menu screenshots at normal and minimum widths. Record outcomes and any remaining environment-specific manual gates here. Depends on tasks 1–3.
5. **Review and integrate.** Review the complete diff, commit and push the feature branch, create a PR, resolve every failing required check, merge after the exact head is green, and verify clean local master matches the remote merge. Depends on task 4.

## Acceptance criteria

- Linux shows one compact app menu plus history and project search, and has no duplicate native reader menu.
- Linux keeps native/window-manager title bar and controls; its toolbar uses available width. Windows caption controls retain their reserved area.
- F10 opens/closes the menu; arrows/Home/End navigate it; Escape restores trigger focus; outside click dismisses. Ctrl+K filters projects and Enter navigates. Open dialogs keep their own keyboard interaction.
- Zoom, fullscreen, history, home, settings and quit shortcuts still work. Standard copy/paste/undo and Alt+F4 remain native.
- Cloud, backups/recovery, AI, CLI, privacy/diagnostics, Kindle, updates, feedback, licenses and startup controls remain reachable. Starting/failure recovery retains native commands.
- A browser or disabled bridge receives no desktop toolbar or layout offset. IPC validation and the normal renderer sandbox remain intact.
- Tests never read/write a personal library or contact real assistant/cloud providers. No release/version/host-install changes are included.
- All PR checks pass on the merged head; merge SHA and validation results are recorded.

## Validation results

Implemented and validated on 2026-11-15. Review found and fixed two regressions before integration: the projects header still used the legacy Windows flag when capabilities explicitly disabled the menu; startup registration now rejects requests without a ready library, preserving its profile/library arguments.

| Check | Result |
| --- | --- |
| Root typecheck and complete application build | Passed |
| Desktop Node tests | 67 passed, including real preload sandbox contract tests |
| Core tests with coverage thresholds | 250 passed; 1 emulator-only test skipped in this run |
| Firebase Firestore/Storage emulator contracts | 14 passed separately |
| Frontend Playwright | 119 passed, including 12 desktop-menu cases |
| Extension Playwright | 23 passed with local provider fixtures |
| Extension deterministic archive | Passed |
| Packed npm install outside checkout | Passed, including fixture chat and saved note |
| npm package dry run and credential scan | Passed |
| Packaged Linux Electron 45.1.0, normal sandbox, temporary HOME/XDG/profile/library | Passed |

The packaged run checks native startup/recovery menu availability, rejection of startup registration before readiness, actual shared menu rendering, license command presence, absence of a duplicate native reader menu, full toolbar width, and enabled renderer sandbox. It also verifies graceful shutdown and the authenticated bundled CLI without system Node. The application was staged with a local version override; no tracked version or installed application changed.

Visual QA inspected the real packaged renderer capture and browser screenshots at 1280×800 and 600×400. The Linux toolbar fills its frame, and the menu scrolls within the minimum viewport with visible keyboard focus. Windows browser tests confirm caption space and drag-region preservation. Local packaged evidence is `/tmp/pdfpal-shared-menu-evidence/linux-acceptance.json` and `shared-menu.png`; Playwright captures are under `frontend/test-results/` (generated artifacts, not committed).

Remaining environment checks are interactive native frames/trays on other window managers and GNOME/Wayland. Actual Windows caption rendering continues to rely on Windows installer CI and Windows manual acceptance; browser tests verify the shared frontend contract. OAuth, real assistants and install/upgrade were outside this menu change. PR checks and the eventual merge SHA are reported in the integration handoff.
