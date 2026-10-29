# Windows desktop M2 results

Date: 2026-10-29.

Status: implementation and local packaged verification complete; [review PR 8](https://github.com/andrepaim/pdfpal/pull/8) is stacked on M1. Fresh-account usability and the live Claude gate remain manual acceptance.

M2 adds guided assistant setup, connection checks, and recovery to the accepted M1 desktop alpha. The application remains an unsigned unpacked engineering build; installation/signing/upgrade distribution is M3.

## User journey

On first launch, a themed setup dialog detects Claude Code and Codex. It preserves an explicit CLI/configuration preference. For a new user, one assistant with account authentication can be preselected; otherwise the user chooses. Detection never submits an inference request.

Each assistant shows a distinct installation/authentication state: missing, installation needs attention, update needed, account detected, sign-in needed, API/external credentials, or unknown sign-in status. Passive checks inspect version, necessary CLI capabilities, and the provider's authentication status. They do not claim subscription entitlement, remaining allowance, or a working connection.

Installation and sign-in require a user action and an explanation inside the app. The app opens a visible, non-elevated PowerShell window with the fixed official installer or the discovered executable's official login command. No terminal commands need to be copied. The user finishes in that window, closes it, then checks again. The installer/sign-in window is independent of the reader, so closing pdfpal does not interrupt an installer. Only one setup window is launched at a time. Official setup guides remain available when installation fails or Windows is offline. Advanced users can select an executable with the native file picker; it is verified before its path is stored, and environment overrides remain authoritative.

Check again refreshes Windows user/machine PATH and knows the standalone Codex, npm-native Codex, WinGet-link, and native Claude locations. It does not search the document's working directory.

The optional connection test appears as a secondary action inside the selected assistant’s card, with its verification timestamp beneath it. It sends only a fixed prompt through the normal bounded provider runner. The dialog explains provider allowance use and requires acknowledgement for API/external billing configurations. A successful fixed response records a timestamp tied to the executable identity, version, and authentication mode. Changing that identity invalidates the displayed verification. Cancel test, Escape, closing the dialog, service shutdown, and timeout cancel the owned test without cancelling unrelated questions. Neither a pending nor a failed test is reported as verified.

Start reading persists the selected assistant and setup completion. Continue without AI records completion without changing the assistant preference. Closing setup before completion allows reading and resumes setup on the next launch. All actions remain accessible through AI settings.

## Recovery and security

Startup failures use a local themed recovery page, independent of the backend. It offers Retry, diagnostics, Quit, and a validated existing-server link where available. A failed service can restart once automatically. For the same library origin, the reader stays mounted, preserving unsaved drafts and the reading view. Interrupted questions are not replayed. Repeated failures leave a retry action in the reader and tray. Quit still attempts draft flushing while the backend is unavailable and offers to keep editing if it cannot save.

Provider failures become typed, plain-language errors for sign-in, usage limits, connectivity, setup/update, cancellation, and timeout. Raw provider output is excluded from these errors. Reader/project chat errors have an AI settings action. Kindle receives the same safe provider errors without losing its existing extension pairing.

Diagnostics can be previewed from the reader/tray or startup recovery page and exported through a native save dialog. The exported JSON is the previewed snapshot. A local 50-event ring contains only allowlisted event codes and timestamps. Reports include allowlisted app/provider versions, platform, installation/authentication state, and event codes; they exclude full paths, account identifiers, raw provider output, credentials, prompts, documents, and answers. There is no telemetry upload.

The security review added or verified these boundaries:

- Sandbox and context isolation stay enabled; renderer Node integration, permission requests, webviews, and external navigation remain disabled.
- Every privileged IPC request must originate from the owned top-level app frame. The exact local recovery file has only recovery/diagnostic/quit privileges. Provider IDs and action names are allowlisted; the renderer cannot provide commands, installer URLs, prompts for connection tests, executable paths, or export paths.
- Installer scripts use fixed official URLs. Login paths come from verified discovery and are quoted as literal PowerShell strings. Application paths come only from a user-operated file picker.
- The reader API rejects foreign/null origins, cross-site browser requests, and loopback DNS rebinding. The paired extension retains its separate origin/token gate. No HTTP route exposes installation, login, or a desktop connection test.
- A content security policy blocks remote scripts, document frames, object embeds, and inline JavaScript while retaining PDF workers, image data, and WebAssembly support. Markdown uses React Markdown without raw HTML rendering; document/assistant text is not executable desktop UI.
- Claude reading requests disable built-in and MCP tools. Codex keeps approval `never` with a read-only sandbox, uses ephemeral sessions, disables the shell tool and web search, and ignores user configuration/rules so unrelated user MCP tools are not loaded. These calls still use the provider's existing authentication. Advanced custom Codex provider/configuration setups are not inherited by this isolated reading invocation; an incompatible CLI surfaces Update needed or setup guidance rather than silently weakening restrictions. OpenCode remains an existing CLI option, not a new guided-install provider.

## Verification

- Core regression suite: 119 tests passed with coverage thresholds, including private-error classification, selective cancellation, atomic executable configuration, hostile origins/hosts, and absence of privileged desktop HTTP routes.
- Desktop helper tests: preferences plus setup-command quoting, main-frame/origin restrictions, recovery descriptions, and bounded redacted diagnostics.
- Full reader browser suite: 52 tests passed, including setup completion/resume, no passive generation, assistant selection, separate billing acknowledgement, install/sign-in consent, connection success/offline/cancellation, service retry, diagnostic preview/export, and existing notes behavior.
- Initial CSP failures in screenshot-data reads were fixed; PDF appearance, selection, and reading-position tests pass.
- Full Kindle companion browser suite: 23 tests passed. The old raw-error expectation was updated to the safe sign-in message; preserving non-Windows discovery semantics restored the PDF-selection visual flow. The affected capture/visual tests passed after those fixes.
- Native Windows fixtures cover account, API, signed-out, unknown, missing, unsupported, offline, and PATH-refresh states without changing personal credentials.
- Packaged Windows acceptance covers first-launch UI, no passive generation, a real renderer/preload connection test, completion persistence, cancellation, redacted diagnostics, rejected privileged actions, tray/background answers, paired extension access, crash recovery, and graceful shutdown. The same path is exercised with system Node absent from PATH.
- One real Codex 0.164.0 account-authenticated question passed through the packaged reader with the new isolated invocation flags. Routine acceptance uses a deterministic native fixture; it is not evidence of real Claude inference.
- The npm tarball installed outside the checkout and passed guided pairing, fixture chat, and saved-note checks. Extension archive validation passed.

The exact official installer commands and login syntax were checked against [OpenAI's Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli), [OpenAI authentication](https://learn.chatgpt.com/docs/auth), [Claude setup](https://code.claude.com/docs/en/setup), and [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). The Codex standalone install script currently uses `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`; refreshed registry PATH remains the primary way to discover future layout changes.

## Remaining manual/release gates

A truly fresh Windows account must still exercise a real assistant download and browser sign-in, including any Windows policy/network prompts, and a nontechnical reader must complete the first-PDF journey unaided. Automated fixtures do not establish that usability target. No real assistant is installed, upgraded, logged out, or reauthenticated by automated acceptance on the maintainer's machine. Fresh Claude authentication/inference remains an explicit unverified live-provider gate. Real Windows login/logout, installer/signing/upgrade/uninstall distribution, and beta activation measurements remain later acceptance work.

## Reproduce

```powershell
npm ci
node desktop/scripts/stage.mjs
./desktop/scripts/windows-m2.ps1 -SourceRoot (Get-Location).Path
```

A Windows test copy is prepared at `%LOCALAPPDATA%\pdfpal-alpha-m2`. Quit the previous build from its tray, then run **Launch pdfpal test.cmd** there. It uses the existing `%LOCALAPPDATA%\pdfpal-m0-test` library and normal desktop profile; setup appears once until completed.

The driver defaults to the existing `%TEMP%\pdfpal-windows-m1` build/cache directory for local iteration. Receipts and `setup.png` / `ai-settings.png` are stored there. `-SkipInstall` reuses locked dependencies. `-LiveCodex` opts into one real fixed-question request using provider allowance; CI does not enable it.
