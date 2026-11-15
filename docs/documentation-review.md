# Documentation review — November 15, 2026

Reviewed the default branch, `master`, starting at `a402cec` (PRs through #20). Checked the README, desktop/extension guides, CLI skill, contributor guide, current runbooks, plans/evidence, version/build scripts and the reader implementation. Historical milestone receipts keep their dates and measured results; unmerged Mac/mobile/share-card work is not presented as shipped.

| Finding | Improvement |
| --- | --- |
| Guides were mixed with plans and dated acceptance receipts, with no entry point | Added a [documentation index](README.md) distinguishing current instructions, historical evidence and future work. |
| The README still showed the original visual format and its old export | Captured the current figure renderer, progressive token grids and expanded query/key plot; replaced the downloadable HTML using the app's own exporter. |
| New visual controls and persistence limits were hard to discover | Added a [visual guide](visual-explanations.md), covering progress segments, arrow keys, named details, expansion, transcripts, offline export, retry and local-only assets. Updated the companion guide's obsolete control names. |
| The dictionary had only a feature-list mention | Added a [reader guide](reader-guide.md) and a dictionary screenshot, including English-only scope, compound/base-form behavior and no-provider lookup. |
| Windows instructions named old installer versions; Linux installation was buried | Replaced stale “current” version examples, documented Linux preview release downloads and CI artifacts, runtime/CLI/lifecycle/keyring differences, and corrected the platform architecture. Kept experimental/manual gates explicit. |
| The README omitted the new account-library choice and mismatch recovery | Documented one library per Google account, explicit legacy selection and separate restore without merging or deleting original local work. Updated recovery/privacy entry points for desktop/browser. |
| The shipped automation skill assumed every desktop was Windows | Added a Linux reference and routing to `pdfpal-desktop-cli`, retaining fingerprint guards, operation receipts and note concurrency checks. |
| Contributor guidance omitted merged work and understated CI | Updated the developer guide for Linux transport, current feature scope and Firebase/extension/package/platform checks. Removed the README's inaccurate claim that reading subprocesses can browse the web. |
| Documentation edits triggered full browser, Firebase and native installer builds | Added a shared PR/push change classifier with real Git-history tests. Docs/media-only changes retain lightweight checks; code, CI, tooling and shipped skills keep full validation. Manual Windows runs remain full. |
| Links could drift silently; a plan linked to an unmerged signing document | Added `npm run check:docs` and CI validation of tracked Markdown paths and heading fragments. Redirected the signing link to merged release instructions. |

## Verification

The screenshot refresh runs the actual local server and browser with a temporary library and unavailable provider executables. It imports public papers, restores recorded responses without editing their definitions, checks all nine visual steps, and opens the downloaded HTML with networking disabled. No normal library, provider credentials or AI allowance are used. Capture provenance and reproducible commands are in [CAPTURE.md](../screenshots/CAPTURE.md).

Validation includes a complete source build, TypeScript checking, the existing browser tests for visuals/dictionary/dark pages/PDF links, CLI skill validation, Markdown links and whitespace checks. The PR's existing CI runs the broader core, package, extension, Firebase and platform checks before merge. Documentation, capture tooling and CI path selection do not change library schemas, release versions or application behavior.

The separately published Linux preview `linux-desktop-v2.8.0-beta.5.linux.1` appeared during the review. Its published Debian package, integrity manifest and checksum assets were checked before adding the direct download path; CI artifact availability and automatic Windows publication remain distinct.
