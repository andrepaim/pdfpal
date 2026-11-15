# Coordinated desktop release preparation

## Intended behavior and acceptance

One authorized desktop release publishes Windows x64 and Linux x64 from the same clean full source SHA and desktop version, under `desktop-v<version>`. The draft remains unpublished until shared regressions, native Windows installer acceptance, Linux packaged GUI/authenticated CLI, private synthetic keyring, Debian identity, and all six asset integrity/provenance checks pass. Preview signing and manual acceptance limitations remain explicit. Published tags and bytes are immutable; an incomplete draft can be repaired only for its original SHA.

The current release preparation targets `2.8.0-beta.6`, above both the last Windows `2.8.0-beta.4` and separate Linux `2.8.0-beta.5.linux.1` previews. Verify unused tags before the version change. Desktop and npm versions remain independent.

## Scope and risks

Affected components are the release workflow, publisher, regression tests and platform documentation. Application identity, migrations, library ownership, update trust filters and account behavior remain unchanged. A premature Windows-only publication is the primary risk; publication must depend on a verified combined payload. Native builds must retain their originating source provenance when artifacts are combined. Retries must never replace published assets or move a tag.

## Implementation and integration

1. Add failure-first regression coverage for missing Linux assets, mismatched source/version, dirty builds, package identity, checksum corruption, partial-draft repair and immutable published releases.
2. Extend the native Windows preparation with clean-checkout provenance. Combine its preserved build plan with independently generated Linux metadata, validating actual bytes and Debian control fields.
3. Run both native build/acceptance jobs on release-tooling PRs, collect their artifacts, and verify the combined payload without publishing. On an authorized version change on master, publish only after the same build and regression gates succeed.
4. Merge this preparation through a PR after its exact head checks pass. Verify merged CI. Then open a separate desktop-version PR with current release notes, merge only after required checks pass, and verify the automatic coordinated release on its exact merge SHA.
5. Download the six published assets and independently check tag, channel, size, package identity, SHA-256 values and source metadata. Record evidence and limitations in the release receipt.

## Validation and boundaries

Run publisher regression tests locally, documentation link and secret checks, and workflow inspection. GitHub Actions supplies native Windows and Ubuntu packaged checks plus the normal type, unit, browser, extension, distribution and Firebase emulator checks. Use only isolated synthetic test profiles and credentials. Preserve Electron's renderer sandbox and use only path-scoped CI AppArmor configuration. No production Firebase deployment, provider calls, npm publication, personal-account changes or user-machine app installation are part of this release.

Engineering previews retain the platform runbooks' outstanding real OAuth/keyring recovery, interactive desktop-environment and clean-machine installation/upgrade limitations. These limits must appear in release notes; the release does not claim stable/public-beta acceptance.
