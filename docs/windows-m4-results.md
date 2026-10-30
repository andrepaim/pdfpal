# Windows desktop M4 beta-readiness results

Date: 2026-10-29. Desktop build: `2.1.0-preview.3`.

Status: engineering preparation for an observed Windows beta is implemented. This is not completion of the public-beta decision. Publisher signing, clean-account provider install/login, reference-machine performance, and actual participant results remain external acceptance gates. No release was published and no participant invitations were sent.

## Measured development-machine baseline

The full native Windows run completed **20 fresh process launches** and **50 complete tray cycles**. [Raw measurement receipt](evidence/windows-m4-measurements.json) contains all startup samples and hardware conditions. Its `status: passed` describes successful functional checks, not certification on reference hardware.

| Measurement | Observed result | Planned budget |
| --- | --- | --- |
| Launch to rendered usable library, p95 of 20 | **795.5 ms** | At most 5 seconds on the reference machine |
| Private working set after reading a sample PDF and 60 seconds hidden | **166.54 MiB**, across 5 owned app processes | At most 300 MiB on the reference machine |
| Total working sets, summed across those processes | 517.68 MiB; shared pages can be counted more than once | Context only |
| Private committed bytes | 404.25 MiB | Context only; not private resident working set |
| Idle CPU over a 5.04-second sample | **0.013%** of the machine | Below 1% on the reference machine |
| Full start/answer-hidden/reopen/second-launch/quit cycles | **50/50**, including no owned descendants left running | 50 consecutive cycles |

Machine: Windows 11 Pro build 26300, Intel Core i9-12900F, 24 logical processors, 63.8 GiB RAM. It is the existing development account, not the planned Windows 11 SSD/16 GB reference machine. OS caches were retained. The initial setup completed before the 20 timed launches; each measured launch used a fresh process and the isolated library. Provider installation/login time is measured separately in human sessions. This run does not establish a clean OS account, an actual download/reputation experience, battery behavior, GPU-memory use, or real provider latency.

Memory uses Windows' private working-set counter, summed over the test application's Electron main/renderer/GPU/utility processes; external provider processes are excluded. CPU sums process CPU deltas, divided by wall time and logical processor count. The test uses a synthetic delayed provider, sends no personal PDFs to a provider, and consumes no personal allowance. There was one warm-up answer followed by one independently persisted answer per cycle. Each cycle reopens the saved answer in the actual reader, starts a second instance, verifies one backend, quits normally, and checks remembered descendant identities for orphans. Production installations and unrelated processes are outside the test tree.

The first stress attempts exposed a status-file handoff race in the test controller: PowerShell's default read sharing could briefly prevent Node's atomic rename. The reader now permits delete-sharing and the writer has bounded retries for transient Windows locks. The full 20/50 run then passed. This was a harness correction; no reader behavior or memory tuning was needed to meet the initial development-machine budgets. Future receipts explicitly label functional success separately from reference-machine performance acceptance.

## Repeatable engineering checks

`windows-m4.ps1` packages an isolated unsigned application and runs `windows-beta-measure.ps1`. Defaults are 20 launches, 60 seconds hidden idle, and 50 full cycles. `-SkipInstall` and `-SkipPackagedChecks` are local iteration options after the corresponding pinned setup and M2 checks. CI exercises a smaller 3/3/5-second functional sample alongside M3's installer matrix; a manual **Windows beta measurements** workflow supports the full run. Hosted runner numbers are diagnostic and do not silently become reference-machine acceptance.

The internal file-control mode is allowed only with the installer-acceptance app ID and a dedicated UUID-named directory directly under the OS temporary folder, with matching separate library, database and profile paths. Normal production metadata cannot enable it. It adds no renderer IPC capability, local HTTP endpoint, remote debugger, telemetry, or provider credential access.

The first hosted benchmark timed out before usable readiness. Startup now fails fast for invalid layouts, uses native Node's temporary-directory lookup consistently, captures test-process stderr, and bounds the compositor-frame wait. A locked/hosted desktop can suppress frame callbacks; future receipts record whether frames were actually observed instead of calling a DOM-only result painted readiness. The recorded development-machine baseline above completed the original two-frame wait.

Unit checks cover that isolation, session validation, milestone order, eligible/read-only cohorts, first-attempt versus retry denominators, updated-report deduplication, pending/no-response retention, invalid early follow-up, Sandbox path escaping, and installer identity/hash verification. Browser checks exercise local report downloads, milestone preservation on follow-up, no network requests, and filtering unrelated baseline fields from imports. The regular core, reader, companion, installer, and CLI distribution checks remain enabled.

## Field-test kit

The [Windows beta field guide](windows-beta-guide.md) and generated kit include the production installer and hash manifest, sample PDF, normal Windows quickstart, local observer recorder, and an optional Microsoft Windows Sandbox launcher. `Open Sandbox.cmd` regenerates mappings at the kit's current location, including after moving or downloading it. Only the payload is mapped read-only and the dedicated results folder writable. Windows Sandbox was unavailable on this host; generating and inspecting a configuration is not reported as having run a clean Sandbox session. Sandbox is also distinct from Codex's own native sandbox.

The observer opens `payload/Session recorder.html`, explicitly starts its clock, then runs the normal installer from Explorer. The optional local file picker hashes the installer against the manifest and does not execute it. The observer records an anonymous participant ID, setup cohort, selected assistant, account eligibility, technical background, milestones, assistance/barrier, usefulness, and later return-use status. No prompts, answers, PDFs, account identities, hostnames or credentials enter that report. Data remains local until the maintainer chooses to share it. Live sign-in remains with the provider and account owner.

Packaging the first kit was blocked by Windows security on its optional PowerShell browser/installer launcher. That automation was removed entirely. The delivered participant flow uses an ordinary HTML page and an explicitly launched installer; the optional Sandbox helper is visible and opens the payload folder rather than executing installation commands. Security protection was left enabled. The redesigned kit is rebuilt and archived through native Windows for validation.

`beta-report.mjs` aggregates local session JSON. It retains raw sample counts, deduplicates follow-up saves, measures cohort activation from each eligible participant's first attempt, separates reading without AI, and counts each activated participant once for retention. Missing follow-up is explicit, not fabricated non-return. Small cohorts and the empty current participant dataset remain **insufficient-sample**. The tool never approves or publishes a release.

## Remaining acceptance and signing handoff

- An owner-observed fresh ordinary Windows 11 account/VM: no prior Node/npm/Git or agents, real installation/sign-in and first answer for each promoted provider. The isolated explicit-missing-executable case passed here; it is not this clean-account gate.
- Repeat the startup and tray measurements on the recorded SSD/16 GB reference hardware. Observe cold OS caches, sleep/wake, logout/startup, DPI, accessibility and actual downloaded signed installer prompts separately.
- Configure a real publisher identity in the `windows-release` GitHub environment: `PDFPAL_PUBLISHER_NAME` variable plus `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` secrets, or use an existing local Windows-store certificate with the documented thumbprint option. The environment's access protections and credentials are maintainer configuration. No signing identity or private key is supplied by this work.
- After review/merge, run the master-only signed-candidate workflow. It requires valid timestamped app/installer signatures and the expected publisher before writing a signed manifest, and uploads the candidate for review. A real signing round trip remains pending.
- Observe at least 20 eligible beta participants, including at least 10 nontechnical readers, with sufficient samples in both setup cohorts and at least 20 activated people for the 14-day return-use denominator. Use the desktop plan's success targets; participant outcomes currently number **zero**.

Publication remains a separate decision after these gates and human review. Existing CLI distribution remains independent of Electron.
