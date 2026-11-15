# Working on pdfpal

## Project context

- pdfpal is a local-first PDF and Kindle reading assistant with a shared TypeScript core, browser reader, Chrome companion, standalone npm CLI, and Windows/Linux Electron desktop apps.
- Read [CLAUDE.md](CLAUDE.md) for architecture, commands, database migrations, and product constraints. Read the relevant component documentation before changing its behavior. The release policy below adds cross-platform requirements to the existing platform runbooks; their historical version examples are not the current release state.
- Use Node.js 22 or newer. Root npm workspaces are `frontend` and `extension`; `desktop/` has separate tooling and lockfiles. Do not install or rebuild desktop native dependencies in the root dependency tree.
- Shared reader, core, sync, account, and desktop changes must be assessed on both Windows and Linux. A fix merged into `master` is not available to installed users until matching installers are published; publication is not proof that a user installed the update.

## Default engineering workflow

- Follow the user's authorized scope through planning, implementation, validation, and any requested integration. A request to edit this policy alone does not authorize an issue-processing run, workflow changes, a release, or deployment.
- Before implementation, record the intended behavior, acceptance criteria, affected components/platforms, compatibility and data risks, implementation steps, and required validation. Scale the plan to the change and update it when scope changes.
- Start a short-lived feature branch from current `origin/master` before editing. Use a separate Git worktree for independent concurrent work. Check for existing edits and other sessions' ownership; preserve unrelated work and never switch or reset another session's checkout.
- For testable features and bug fixes, first add a meaningful regression test and confirm the expected failure, then implement and verify the behavior. Cover relevant failure and recovery paths. For documentation or purely visual changes, use accuracy/layout checks appropriate to the change instead of tests that mirror the implementation.
- Keep each change small and reviewable. Commit only intended task files. When integration is authorized, use a pull request, reconcile current `origin/master`, review the combined changes, pass required checks on the resulting revision, and verify CI on the merged commit. Never force-push `master`.
- Prioritize failing CI and regressions over new work. Record concrete blockers and the next action; preserve unfinished work and continue independent authorized work where possible. Do not bypass checks or call a pushed branch, pending CI run, or unmerged implementation complete.
- Separate implemented, tested, merged, published, and installed status in progress reports. Include the exact tested revision, checks, results, and material limitations.

## Issue handling and coordination

- When asked to work a queue, select only issues within the authorized scope with clear acceptance criteria, satisfied dependencies, and no active owner elsewhere. Prefer established priority, then work that unblocks others, then oldest ready work. Editing instructions or reviewing issues does not start implementation.
- Record the owner, issue, branch/worktree, plan, exact revision, PR if any, validation status, and next action in the tracker. Keep one issue under active implementation; overlap independent work only when ownership and shared resources are coordinated.
- Complete the issue's acceptance criteria and authorized integration before closing it. Distinguish a fix on `master` from a fix present in a published Windows or Linux build. Leave blocked work open with a concrete handoff.
- Coordinate one merge lane and one release owner across sessions. Serialize shared GUI/display, keyring, native build, and installer resources. Separate worktrees do not make those resources exclusive. Do not interrupt another session's tests or alter its app/library state.

## Validation and evidence

- Choose checks from actual behavior and risk, including both platforms for shared desktop changes. At minimum, review affected code and run relevant type, unit/integration, and browser/packaging checks. Automated fixtures do not establish real account sign-in, model inference, native menu interaction, or clean-machine installation.
- Common checks, from the repository root:

  ```sh
  npm ci
  npm run typecheck
  npm test
  npm --prefix desktop test
  npm run build
  npm exec --workspace frontend -- playwright test
  npm exec --workspace extension -- playwright test
  npm run test:archive
  npm run test:package
  node scripts/check-secrets.mjs
  ```

  Install the relevant Playwright Chromium browsers first when needed. `npm test` builds the server; build all surfaces before standalone browser checks. See [CLAUDE.md](CLAUDE.md) for emulator and retrieval commands.
- Sync/schema/rules changes require the real Firestore/Storage emulator contract checks, not the emulator-dependent skipped result from ordinary `npm test`. Keep `src/shared/sync/schema.ts` and the key allowlists in `cloud/firestore.rules` aligned.
- Desktop packaging changes require native packaged acceptance on the affected OS. Shared account, vault, lifecycle, profile, CLI, library, or runtime changes require Windows and Linux evidence. Use [desktop/README.md](desktop/README.md), [Windows release pipeline](docs/windows-release-pipeline.md), and [Linux quickstart](docs/linux-quickstart.md).
- Linux release evidence includes packaged GUI/authenticated CLI acceptance, a synthetic private-keyring secure-storage probe, Debian package checks, and checksum/provenance validation. Preserve the normal renderer sandbox; do not use `--no-sandbox` or disable system-wide security controls to make tests pass.
- Assess interactive native menus/accelerators, supported desktop environments, real OAuth/keyring recovery, and in-place install/upgrade/data preservation explicitly. If required acceptance is unavailable, report the missing gate and leave the affected work unmerged or unreleased as applicable. Historical receipts from another revision are not current validation.
- Tie evidence to a full source SHA, environment, scenarios, results, and limitations. Reuse prior evidence only when its revision and scope actually cover the current change; separately green branches do not prove their combination works.
- For documentation-only changes, check accuracy, local links, and `git diff --check`; full builds are unnecessary unless build behavior changes. CI still runs according to the workflows.

## Data, security, and account boundaries

- Keep the local SQLite library as the working copy. Reading needs no account. Google sign-in, sync, saved-conversation sync, PDF transfers, telemetry, and error reporting retain their separate opt-ins; signing in alone uploads nothing.
- Tests must use temporary libraries/profiles and synthetic credentials. Use `testConfig()` from `test/helpers/test-utils.ts`; never test against the real home database, personal keyring, provider accounts, or live Firebase data. Mock external APIs, agent binaries, and account services in automated tests.
- Preserve migrations, backups, library ownership, and upgrade compatibility. Increment `CURRENT_SCHEMA` for new schema versions and test migration/refusal behavior. Do not share a live SQLite library between Windows and WSL.
- Keep the server loopback-only, enforce Host/origin checks and authenticated desktop/extension bridges, and preserve the renderer sandbox and fail-closed credential storage. Never add plaintext credential fallback.
- Treat PDF/page content as untrusted. Preserve tool-disabled, isolated agent execution and the existing provider restrictions documented in [CLAUDE.md](CLAUDE.md).
- Keep diagnostics content-free and allowlisted. Never log or publish titles, file paths, URLs, prompts, answers, raw error text, tokens, personal content, signing keys, or raw account/session identifiers. Keep sensitive investigation evidence private and sanitize public issues/PRs.
- Feature work and desktop publication do not by themselves authorize paid provider calls, live-account changes, Firebase/backend deployment, destructive tests, installation over a personal app, clearing data, or publishing the npm package. Respect authorization already given for the current task.

## Release ownership and authorization

- Release creation, release version bumps, tags, installer publication, and npm publication require an explicit release request. Do not release automatically after finishing a feature or merging a PR. In particular, do not edit `desktop/version.json` during ordinary feature work: merging a changed version to `master` currently starts Windows publication.
- Designate one release owner to coordinate version, exact source revision, release notes, validation, tags, assets, and final verification. An explicit release request authorizes completing its applicable checklist without repeated permission requests; report concrete blockers instead of bypassing gates.
- An unqualified desktop release request means **Windows x64 and Linux x64 together**, using one increasing version in `desktop/version.json`, the same clean full source SHA, and one canonical GitHub release tagged `desktop-v<version>`. A platform-only release must be explicitly scoped by the user and clearly labeled; never silently substitute it for a desktop release.
- Review every change since the last published build on each platform, including fixes merged after one platform's most recent release. Check ancestry and artifact provenance rather than assuming the newest tag contains a fix. Document platform-specific behavior, compatibility, and remaining preview limitations.
- Desktop and npm versions are independent. Changing the root `package.json` publishes nothing and does not update desktop builds. Do not bump or publish npm as a side effect of desktop work.

## Current release tooling: mandatory prerequisite

- `.github/workflows/windows-release.yml` currently publishes **only Windows** after `desktop/version.json` changes on `master`, or a manual dispatch on `master`. Its Linux regression job tests shared code; it does not produce a Linux installer for that release.
- The `linux-desktop` job in `.github/workflows/ci.yml` builds/tests a Debian package and uploads `pdfpal-linux-x64-preview` as a **CI artifact**. It does not attach that package to GitHub Releases. Creating/publishing a GitHub release does not trigger a Windows+Linux build. An ordinary code merge without a version bump does not update the Windows download.
- The existing Windows publisher validates only its three Windows assets and can publish before any Linux package is attached. Do not use it unchanged for a shared desktop release or assume a green CI run makes both downloads available.
- **Before merging a cross-platform release version bump or dispatching publication, implement and validate a coordinated draft/build/publish path that collects and verifies both platforms, then publishes only after all required checks and assets pass.** Preserve the current signing, provenance, retry, and immutable-publication protections. This is required release preparation when that release work is authorized; if it cannot be completed, report the tooling gap and leave the release unpublished. Editing this document alone does not implement that automation.
- Do not work around this prerequisite by publishing Windows first and promising Linux later, using a separate Linux-only version/source revision, or marking a partial release complete. Retain an incomplete release as a draft for repair. Follow the platform build runbooks for the actual native commands; their Windows-only publication description does not satisfy the combined-release gate.

## Desktop release checklist

1. **Select the release candidate.** Confirm release authorization/scope, one owner, a clean source revision containing the intended fixes, current integration/CI evidence, an unused increasing version, and preview/stable status. Resolve the tooling prerequisite above before the version bump can activate publication. Preserve app identity, signing identity, migrations, and library/configuration compatibility.
2. **Build both platforms from that exact revision and version.** Use the Windows native installer/upgrade/uninstall driver and Linux staged Debian build from the runbooks. Reproduce the relevant CI gates, including shared regressions, browser/extension checks, Firebase contracts, native Windows installer acceptance, and Linux packaged/keyring/Debian acceptance. Record outstanding interactive/manual gates; do not silently waive them.
3. **Verify the complete draft payload.** Require all six files on the same release:

   | Platform | Installer | Integrity metadata |
   | --- | --- | --- |
   | Windows x64 | `pdfpal-Setup-<version>-x64.exe` | `pdfpal-desktop-release.json`, `SHA256SUMS.txt` |
   | Linux x64 | `pdfpal-<version>-amd64.deb` | `pdfpal-linux-release.json`, `SHA256SUMS-linux.txt` |

   Validate the actual package identity/version/architecture, file sizes, and SHA-256 values, including manifest hashes. Check the Windows `release-plan.json` build provenance and Linux manifest `sourceCommit` against the exact release SHA; require Linux `sourceDirty: false`. Do not relabel old installer bytes or generate metadata claiming a newer commit than was built. Linux metadata is generated with `node desktop/scripts/linux-release.mjs <artifact-directory> <full-source-sha>` after the clean build; this command does not publish anything.
4. **Apply channel and trust rules.** Suffixed desktop versions are engineering prereleases; Windows may be unsigned only with explicit preview disclosure. Stable Windows installers require verified publisher signing and the configured release credentials. Linux's current package is an unsigned, manually updated engineering preview; checksums do not prove publisher trust. Do not imply stable Linux acceptance, package signing, AppImage support, or automatic Linux updates have been delivered. Preserve the signed stable Windows updater's trust and platform filtering.
5. **Write accurate notes and publish once complete.** Explain changes since the previous published versions, provide both installation paths, state preview/signing status and manual limitations, and record the full source SHA. Ensure the tag resolves to that SHA. Publish the draft only after both platforms' checks and all six verified assets are present. Preserve desktop/npm separation and the existing repository-wide Latest-pointer behavior unless changing that policy is explicitly in scope.
6. **Verify the public result.** Inspect the published release, resolved tag SHA, channel, notes, and both platform download links. Download the published assets and verify their sizes/checksums/manifests against the tested files. Record release URL, version, full SHA, platform artifacts/hashes, checks, and any limitations. A successful Windows job, Linux CI artifact, local `.deb`, draft, or merged PR alone is not a completed desktop release.
7. **Retry safely.** A failed upload may be repaired while the release is still a draft, after revalidating source and payload. An already-published matching release may be verified without replacing its bytes. Never move a published tag or overwrite published installers/manifests/checksums to retrofit a fix; build a new increasing version. Do not rerun the current version at a different source SHA.
