# Automatic Windows downloads on GitHub

The **Publish Windows desktop release** GitHub Actions workflow builds and publishes a Windows x64 installer when `desktop/version.json` changes on `master`.

For the next preview, change `2.1.0-preview.3` to `2.1.0-preview.4` and merge the change into `master`. After the checks pass, GitHub creates a **prerelease** named `desktop-v2.1.0-preview.4` with:

- `pdfpal-Setup-2.1.0-preview.4-x64.exe` — the normal Windows installer.
- `pdfpal-desktop-release.json` — application/version/signing and SHA-256 metadata.
- `SHA256SUMS.txt` — checksums for the installer and manifest.

Testers open the [GitHub Releases page](https://github.com/andrepaim/pdfpal/releases), select the version, and download the `.exe`. They do not need Node.js or GitHub Actions artifact access. Preview notes explicitly state when the installer is unsigned and Windows may show an unknown publisher. The desktop's in-app update checker continues to offer stable signed releases only.

## What runs

The workflow compares the semantic version against the push's previous commit, so formatting-only edits do not publish. Versions must increase. A push containing several commits publishes the version at its final commit. The npm CLI version is independent; changing `package.json` alone does not publish a desktop installer.

Linux checks cover core tests, reader browser tests, companion browser tests, extension archive and npm distribution. The Windows build runs the existing packaged application and native installer/upgrade/uninstall acceptance matrix. Only after both jobs succeed does a separate job with `contents: write` permission publish the tested files.

Releases are tagged at the exact source commit. The publisher verifies application identity, version, size and SHA-256 before upload, creates a draft, uploads and verifies all assets, then publishes. A failed upload leaves a draft for a retry. An already-published matching version is a no-op; a different source commit or asset hash is rejected. Published binaries are never silently replaced. Desktop releases do not change the repository-wide “Latest” pointer, preserving separation from CLI releases; the desktop updater selects stable desktop versions itself.

Pull requests run publication-logic tests and the usual project CI without publishing or accessing signing credentials. Publishing is restricted to this repository's `master`; it is not triggered by feature-branch pushes. Per-version concurrency serializes duplicate publication attempts.

## Signing and retries

Versions with a suffix such as `-preview.4` or `-beta.1` are published as unsigned engineering prereleases by this workflow. Stable versions such as `2.1.0` require the existing `windows-release` environment's publisher variable and signing secrets. Missing credentials or failed timestamp/publisher verification stop the build before publication. The manual **Signed Windows release candidate** workflow remains available for inspecting a signed build without publishing it.

To retry a failed publication, use **Actions → Publish Windows desktop release → Re-run failed jobs** for that run. **Run workflow** on `master` can publish its current version or verify that it is already published. If code has changed since the existing tag, bump the version instead of reusing it. Signing settings remain documented in `desktop/README.md`.

The workflow must be merged into `master`, together with its desktop prerequisites, before automatic pushes or manual runs can use it. The initial engineering preview may be uploaded from the previously passing Windows CI artifact, with its original source SHA retained, while the stacked desktop changes await merge. The next merged version bump then uses the automatic pipeline.

The initial [2.1.0-preview.3 download](https://github.com/andrepaim/pdfpal/releases/tag/desktop-v2.1.0-preview.3) was published from the successful Windows CI run for commit `380d40422dc2e80a81aaa63b4ae505d831e3ad61`. Its tag and all three server-reported asset digests were verified. Re-running publication verified the existing release without replacing assets. The next automatic preview should use a new version, such as `2.1.0-preview.4`.

Implementation references: [GitHub workflow triggers and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [draft release creation](https://cli.github.com/manual/gh_release_create), and [release asset digests](https://docs.github.com/en/rest/releases/assets).
