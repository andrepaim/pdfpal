# Automatic desktop downloads on GitHub (Windows and Mac)

The **Publish Windows desktop release** GitHub Actions workflow (`.github/workflows/windows-release.yml`) builds and publishes the desktop app when `desktop/version.json` changes on `master`. It keeps its original name, but it now builds two platforms: a Windows x64 installer and an Apple Silicon Mac disk image. Both go into one GitHub release, and the release is published only when both builds pass.

> **The Mac part is experimental and has never run.** The `build-mac` job and the two-platform publication logic are covered by unit tests on Linux, but no GitHub Actions run has exercised them and the Mac build has not been tested on a Mac. The first version bump after this change is the first real run. See [Turning the Mac requirement off](#turning-the-mac-requirement-off) if it blocks a Windows release.

## What a release contains

For a version such as `2.9.0-beta.1`, GitHub creates a **prerelease** named `desktop-v2.9.0-beta.1` with:

- `pdfpal-Setup-2.9.0-beta.1-x64.exe`: the Windows installer.
- `pdfpal-desktop-release.json`: the Windows manifest (application, version, platform, signing state, size and SHA-256). Installed Windows apps read this file name, so its name and meaning do not change.
- `pdfpal-2.9.0-beta.1-arm64.dmg`: the Mac disk image, Apple Silicon only.
- `pdfpal-desktop-release-darwin-arm64.json`: the Mac manifest, with the same fields and `platform: darwin`, `arch: arm64`.
- `SHA256SUMS.txt`: checksums for the four files above.

Releases published before the Mac build was added (up to `2.8.0-beta.1`) contain only the three Windows files and are not changed.

Testers open the [GitHub Releases page](https://github.com/andrepaim/pdfpal/releases), select the version, and download the `.exe` or the `.dmg`. They do not need Node.js or access to workflow artifacts. The release notes say when a build is unsigned; the Mac paragraph, present only when the release has Mac files, names the `.dmg`, says it is for Apple Silicon only and not notarized, gives the **System Settings → Privacy & Security → Open Anyway** steps, and says the library is `~/.pdfpal`. See the [Windows quickstart](windows-quickstart.md) and the [Mac quickstart](mac-quickstart.md).

The in-app **Check for updates** only offers signed stable releases, and each platform reads only its own manifest: Windows reads `pdfpal-desktop-release.json` and is only offered the `.exe`; a Mac reads `pdfpal-desktop-release-darwin-arm64.json` and is only offered the `.dmg`. A release without a Mac manifest counts as "no release" on a Mac. Other platforms and architectures are never offered anything (`desktop/src/updates.mjs`).

## What runs

The workflow compares the semantic version against the push's previous commit, so formatting-only edits do not publish. Versions must increase. A push containing several commits publishes the version at its final commit. The npm CLI version is independent; changing `package.json` alone does not publish a desktop release.

Jobs, in order:

1. **plan** (Linux): secret scan and version comparison. It decides whether to publish and whether the version is a preview or stable.
2. **regression** (Linux): core tests, Firebase rules on emulators, desktop Node tests, reader and companion browser tests, extension archive and npm distribution.
3. **build** (`windows-latest`): the existing packaged-application and native installer/upgrade/uninstall acceptance (`windows-m3.ps1`), then a check of the Windows publication files.
4. **build-mac** (`macos-15`, Apple Silicon): `npm ci`, `node desktop/scripts/stage.mjs`, then `node desktop/scripts/mac-build.mjs --work=…`, which builds, tests and packages the app and writes the disk image and Mac manifest. A stable version stops here (see below).
5. **publish** (Linux, the only job with `contents: write`): runs only after all of the above succeed. It downloads the Windows and Mac artifacts into one folder and runs `desktop-release.mjs publish release-files --require-mac`.

Releases are tagged at the exact source commit. Before any upload the publisher checks, for each platform, the manifest's application identity, version, platform, architecture, file name, size and SHA-256 against the actual file, and rewrites `SHA256SUMS.txt` over all of them. It then creates a draft, uploads all files, checks the server-reported digests of every file, and only then publishes. A failed upload leaves a draft that the next attempt resumes. An already-published matching version is a no-op; a different source commit, a missing file or a different file hash is refused. Published files are never replaced, and a Mac file cannot be added to a release that was published without one. Desktop releases do not change the repository-wide "Latest" pointer.

Pull requests that touch the workflow, `desktop-release.mjs`, `updates.mjs` or their tests run only the validation jobs: the publication and update-check tests and the Linux regression job. They do not build either platform, publish, or access signing credentials. Separate workflows build on pull requests without publishing: the Windows CI workflow (`windows-m0.yml`) prepares and checks the actual installer's publication files, and the Mac build workflow (`mac-build.yml`) builds the Mac app and uploads the disk image as a workflow artifact. Publishing is restricted to this repository's `master`. Per-version concurrency serializes duplicate publication attempts.

## How the Mac files are required

`desktop-release.mjs prepare` and `publish` accept `--require-mac`:

- **Without the flag** a directory with only the Windows files prepares and publishes exactly as before (three files). If either Mac file is present, both must be present and valid, and they are included.
- **With the flag** a missing Mac disk image or manifest is an error, raised before any GitHub call. The flag is also recorded as `requireMac` in `release-plan.json`, so a plan prepared with it keeps requiring the Mac files.

The workflow's publish step passes `--require-mac`, so it cannot publish a release without the Mac files. The Windows build job still runs `prepare` without it, because the Mac files are not on the Windows runner.

## Signing and stable versions

Versions with a suffix such as `-preview.4` or `-beta.1` are published as unsigned engineering prereleases. Windows previews are unsigned; Mac previews are ad-hoc signed (needed for any app to run on Apple Silicon) but not signed with an Apple Developer ID and not notarized, and their manifest says `signed: false`.

Stable versions such as `2.9.0` require the `windows-release` environment's publisher variable and signing secrets for Windows. Mac signing and notarization do not exist yet, so **a stable version cannot be published while the Mac build is required**: the `build-mac` job stops at its first step, and `desktop-release.mjs` independently refuses a stable release with an unsigned Mac manifest. Until Mac signing exists, publish suffixed versions only, or turn the Mac requirement off for that release. The manual **Signed Windows release candidate** workflow remains available for inspecting a signed Windows build without publishing it.

## Turning the Mac requirement off

To publish a Windows-only release on purpose (for example, if the Mac runner is failing and a Windows fix must ship, or for a stable Windows release before Mac signing exists), edit `.github/workflows/windows-release.yml` on `master`:

1. Remove `build-mac` from the `publish` job's `needs`.
2. Remove the `desktop-release-files-mac` download step.
3. Remove `--require-mac` from the publish command.

Then bump the version. The resulting release has the three Windows files, as releases did before. Because published releases are never changed, that version will never get a Mac file; the next version can include it again after the three edits are reverted.

## Retries

To retry a failed publication, use **Actions → Publish Windows desktop release → Re-run failed jobs** for that run. If only the Mac build failed, this re-runs `build-mac` and then `publish`. **Run workflow** on `master` builds both platforms again and publishes its current version, or verifies that it is already published. Rebuilt files may differ byte for byte from published ones; if they do, the publisher refuses rather than replacing anything. If code has changed since the existing tag, bump the version instead of reusing it. Signing settings are documented in `desktop/README.md`.

## History

The desktop app, its prerequisites, and this workflow entered `master` together through the integration PR at `2.1.0-preview.4`. The initial [2.1.0-preview.3 download](https://github.com/andrepaim/pdfpal/releases/tag/desktop-v2.1.0-preview.3) was published from the successful Windows CI run for commit `380d40422dc2e80a81aaa63b4ae505d831e3ad61`. Its tag and all three server-reported asset digests were verified. Re-running publication verified the existing release without replacing assets. The Mac build job and the second manifest were added after `2.8.0-beta.1`.

Implementation references: [GitHub workflow triggers and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [draft release creation](https://cli.github.com/manual/gh_release_create), and [release asset digests](https://docs.github.com/en/rest/releases/assets).
