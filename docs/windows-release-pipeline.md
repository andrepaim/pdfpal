# Coordinated Windows and Linux downloads on GitHub

The **Publish desktop release** GitHub Actions workflow builds Windows x64 and Linux x64 together when `desktop/version.json` changes on `master`. It uses one version, one clean full source SHA and one canonical GitHub release, `desktop-v<version>`.

A successful release contains all six files:

| Platform | Installer | Integrity metadata |
| --- | --- | --- |
| Windows x64 | `pdfpal-Setup-<version>-x64.exe` | `pdfpal-desktop-release.json`, `SHA256SUMS.txt` |
| Linux x64 | `pdfpal-<version>-amd64.deb` | `pdfpal-linux-release.json`, `SHA256SUMS-linux.txt` |

Download from the [GitHub Releases page](https://github.com/andrepaim/pdfpal/releases). Windows users run the `.exe`; Linux users keep the `.deb` and its two integrity files together, run `sha256sum -c SHA256SUMS-linux.txt`, then install with apt as described in the [Linux quickstart](linux-quickstart.md). No separate Node.js installation is needed for either packaged app or its bundled CLI. The npm package version is independent. No Mac release target is merged into this branch.

## What runs

The workflow compares the semantic version against the push's previous commit, so formatting-only edits do not publish. Versions must increase. A push containing several commits publishes the version at its final commit. Ordinary application merges and CI artifact uploads do not update installed users' downloads.

The shared regression job checks core and desktop tests, the actual Firebase emulator contracts, reader and companion browser tests, the extension archive and npm distribution. The Windows build runs the packaged application and native installer/upgrade/uninstall matrix. The Linux build stages its isolated runtime, builds the Debian package, exercises the normal sandbox and authenticated bundled CLI, probes a private synthetic keyring, and validates the extracted Debian package. CI uses only a path-scoped AppArmor policy; the renderer sandbox stays enabled.

The combined job checks the preserved Windows `release-plan.json` build provenance and Linux manifest against the exact workflow SHA/version, requires both sources clean, validates Debian control identity, and verifies all six asset sizes, hashes and checksum entries. It cannot replace missing or stale native provenance with the combining job's SHA. Native receipts and the complete verified payload remain available as Actions artifacts.

Only after these jobs succeed can a separate job with `contents: write` create a draft, upload and verify all six assets, then publish. Tags resolve to the exact source commit. A failed upload leaves a draft for repair at that SHA. An already-published matching version is verified without mutations; a different SHA or asset digest is rejected. Never replace a published build or move its tag. Desktop releases preserve the repository-wide “Latest” pointer; the desktop updater selects stable signed Windows releases itself and Linux uses manual updates.

Release-tooling pull requests run both native builds and combined verification without publishing. Usual project CI and Windows PR checks also run. Publication is restricted to this repository's `master`; feature-branch pushes cannot publish. Per-version concurrency serializes publication attempts. The [preparation plan](coordinated-desktop-release-plan.md) records this transition from the former Windows-only publisher.

## Signing and retries

Suffixed versions such as `-preview.4` or `-beta.6` are engineering prereleases. Windows may be unsigned with explicit unknown-publisher/reputation disclosure. Stable Windows installers require the `windows-release` environment's publisher variable and signing secrets; missing credentials or failed publisher/timestamp verification stop publication. The manual **Signed Windows release candidate** workflow remains available without publishing. Linux is currently an unsigned, manually updated engineering preview; checksums establish integrity, not publisher trust. AppImage and automatic Linux updates are deferred.

Native automated acceptance uses isolated libraries and synthetic credentials. Real OAuth/keyring recovery, interactive menus and desktop environments, fresh-account onboarding, and clean-machine installation/upgrade still need manual acceptance. Release notes retain these limitations; publication does not establish stable/public-beta acceptance or installation on a user's machine.

To retry, use **Actions → Publish desktop release → Re-run failed jobs** on the original run. **Run workflow** on `master` can publish the current version or verify an existing matching release. If source code has changed since its tag, bump the version rather than reusing it. Signing settings remain documented in [desktop/README.md](../desktop/README.md).

## Historical releases

The initial [2.1.0-preview.3 Windows download](https://github.com/andrepaim/pdfpal/releases/tag/desktop-v2.1.0-preview.3) was published from `380d40422dc2e80a81aaa63b4ae505d831e3ad61`. The [2.8.0-beta.5.linux.1 Linux preview](https://github.com/andrepaim/pdfpal/releases/tag/linux-desktop-v2.8.0-beta.5.linux.1) was published separately. Those historical receipts do not identify a current coordinated release or validate a later revision.

Implementation references: [GitHub workflow triggers and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [draft release creation](https://cli.github.com/manual/gh_release_create), and [release asset digests](https://docs.github.com/en/rest/releases/assets).
