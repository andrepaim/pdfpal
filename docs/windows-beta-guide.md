# Windows beta field guide

This is a supervised test kit, not a public release. Use an eligible Claude Code or Codex account and the supplied sample PDF. The current installer is unsigned. Signing and a real fresh-account installation/login test are still release gates.

## Run a session

1. Extract the entire kit. Keep its folders together. Read `payload/Windows quickstart.txt`.
2. On the Windows account being tested, quit existing pdfpal tray instances, then double-click **payload/Start test.cmd**. It verifies the installer bytes, opens the local observer recorder, and launches the normal installer. It does not bypass Windows publisher/reputation prompts.
3. The observer assigns an anonymous ID such as **P01** and chooses the starting cohort: an assistant is already installed/signed in, or installation/sign-in is needed. Confirm eligibility with the participant; command detection alone cannot establish account access or remaining allowance.
4. Let the participant install pdfpal, choose/install/sign in to the assistant, open **Sample PDF.pdf**, select a passage, ask for an explanation, close to the tray, and reopen the completed answer. Follow the normal quickstart. The observer clicks milestones as they happen and records any assistance or barrier. After activation, let the participant read a passage from a book/paper they actually want to understand; rate that explanation's usefulness. Keep the passage and answer out of the report. If the session stops, save it with missing milestones.
5. Save the anonymous JSON report through the browser. Review it before sharing; do not include PDFs, account names, prompts, answers, screenshots of login, or credentials. Keep the report in the kit's **results** folder. Use the same anonymous participant ID for retries; use different IDs for different people.
6. Within 14 days, ask whether the participant voluntarily read and asked again on another day. Load the saved JSON from their **first successful session**, update its follow-up, and save the updated copy. Later retries do not reset that session's retention window. Mark no response explicitly. Do not count same-day use as return use or finalize “no return” before 14 days.

The recorder is a local HTML page. It performs no network requests or telemetry and records no PDF content. The launcher checks only command presence on PATH, existing pdfpal folders, Windows build, elevation, and installer signature status. Those checks cannot prove the absence of programs elsewhere. Human confirmation remains necessary for a genuinely clean account. Timing starts at installer launch and includes human installation/setup time; it is distinct from the automated process-start benchmark.

## Fresh Windows acceptance

Use a new ordinary Windows 11 x64 account or a fresh VM with no Node.js/npm/Git, no prior pdfpal library/profile, and no installed agents. Do not sign that account into a provider in advance for the missing-agent cohort. Keep this result separate from a new pdfpal profile on an existing account.

For each promoted assistant, verify: installer launches setup without admin intervention; missing-provider status; install through pdfpal; new executable detected after **Check again**; browser account login; explicit connection test; first answer using the sample PDF; close/reopen; uninstall/reinstall and retained library. Also check offline setup/retry, signed-out state, usage-limit messaging, keyboard navigation, high DPI, and a path containing spaces and accented characters. Record the actual provider version and auth mode in a separate redacted acceptance note. No version/auth probe is proof of successful inference.

Claude's current native installer works without a separate Node.js installation; Git for Windows is optional. Codex has a standalone CLI installer and native Windows sandbox support. Codex's own sandbox is separate from Microsoft Windows Sandbox: verify its native noninteractive invocation on the clean account and keep its permission restrictions. Never disable sandboxing to get a successful result. Use the assistant's official guide if installation or login changes.

Optional: if Microsoft Windows Sandbox is already available, double-click **Open Sandbox.cmd** in the kit root. This regenerates its configuration for the kit's current folder, so downloaded or moved kits work without Node.js. It maps only the payload read-only and the dedicated results folder writable; networking is enabled for provider installation/login. Clipboard, audio, video and printer redirection are disabled. Sandbox does not establish standard-user/UAC behavior, reboot/startup behavior, persistent upgrades, real download reputation, or representative performance. Copy the saved report into **C:\PDFPalResults** before closing; the guest is disposable. This kit does not enable Windows features or create Windows accounts.

## Cohort and decision criteria

Recruit at least **20 eligible readers**, including at least **10 nontechnical readers**, across existing-agent and missing-agent cohorts. Seek at least 10 first attempts per cohort and at least 20 activated people for retention. An eligible account is self-reported here; verify the actual first answer. An account that cannot access the selected assistant is recorded but excluded from eligible-cohort activation calculations. Reading without AI remains a useful outcome and does not count as AI activation.

Targets from the desktop plan: existing-agent activation at least 9/10, median first answer within 5 minutes; missing-agent activation at least 8/10, median within 15 minutes; installation at least 9/10; maintainer assistance at most 20%; useful explanations in at least 8/10 rated sessions; confirmed return use at least 50% of at least 20 activated participants. These are targets, not current results.

The maintainer can aggregate local reports with `node desktop/scripts/beta-report.mjs <results-folder>`. It writes `beta-summary.json`, shows raw denominators, deduplicates updated session reports, uses first attempts for cohort activation, and counts each activated participant once for return use. An unknown/no-response follow-up is not a confirmed non-return or return. A small or empty sample remains “insufficient-sample.” A summary never publishes the app or overrides signing, technical acceptance, or human release review.

Keep a private contact-to-ID mapping outside this kit if follow-up requires it; never put names or contact details in the exported reports. Invitations, account purchases, and publication are separate maintainer actions.

## Maintainer reproduction

Build the current desktop installer with `windows-m3.ps1`. Run `node desktop/scripts/create-beta-kit.mjs <native-artifacts-folder> <native-Windows-kit-folder>` to copy the installer, manifest, sample PDF, local recorder, quickstart and this guide. It verifies the production application ID, installer filename, size and SHA-256. Run it again after moving the kit to regenerate Sandbox host paths.

Run `windows-m4.ps1` for isolated packaged measurements. Defaults are 20 fresh process launches, 60 seconds tray idle plus a five-second CPU sample, and 50 full start/background-answer/reopen/second-launch/graceful-quit cycles. The app, data and profile are separate from normal installations. The benchmark uses a synthetic provider and no personal subscription. Process startup excludes setup/provider probes, retains OS caches, and waits for a rendered usable library. Private working-set memory includes every app-owned Electron/backend process and excludes the external provider. CPU is summed process CPU delta divided by wall time and logical processor count. A development-machine result is not reference-machine acceptance.

## Verified references

- [Official Codex CLI setup](https://learn.chatgpt.com/docs/codex/cli) and [native Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox).
- [Official Claude Code installation requirements](https://code.claude.com/docs/en/setup).
- [Microsoft Windows Sandbox configuration](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file).

Checked 2026-10-29. Recheck official instructions before a signed release; a live new-account login remains unverified until an observed session completes.
