# Windows desktop M1 results

Date: 2026-10-29.

Status: implementation and local Windows acceptance complete; hosted CI verification in progress.

## Delivered behavior

- The reader closes to a system tray and can reopen without losing in-memory state. Answers and the paired extension bridge keep running while hidden.
- A second launch restores/focuses the existing desktop process. A tray failure leaves normal quit behavior available.
- Quit checks active AI requests, offers Keep running or cancellation, and closes owned providers, backend services, and SQLite. Windows session shutdown uses bounded cancellation.
- Explicit Quit flushes pending note saves and reading progress before destroying the renderer. Failed saves offer to keep editing. Note saves are serialized so an earlier failed request cannot restore an older draft over a newer queued edit.
- Window bounds, maximized state, and last route persist separately from the library. Restored bounds fit an available monitor.
- AI settings and the reader selector persist the shared default assistant atomically while retaining configuration keys and environment precedence.
- Optional startup with Windows preserves the selected library, database, port, and application profile.
- Normal reader, Kindle, visual, and CLI agent calls use the shared native Windows resolver and cancellation/output-limited runner.
- Updated CLI and desktop servers coordinate ownership. Existing servers are offered in the browser only after validating the private owner record against the running endpoint. A conflicting server is never killed or adopted.
- Startup backups and migrations serialize across processes, newer schemas are refused, and ordinary compatible CLI writes continue while the server runs.
- An unexpected backend crash gets one automatic restart. Saved history survives; interrupted requests are not automatically resubmitted.

## Local evidence

| Check | Result |
| --- | --- |
| Core regression suite | 114 tests passed with coverage thresholds |
| Existing npm package | Installed outside checkout; guided pairing, fixture chat, and saved note passed |
| Preferences | Three tests pass for persistence, malformed routes, corruption fallback, removed/small monitors, and quoted Windows startup paths |
| Note persistence | Eight note browser tests pass, including immediate desktop flush and an earlier failed save followed by a newer queued draft |
| Windows login registration | A temporary named registry entry is enabled, inspected, and removed by packaged acceptance; existing startup preferences are preserved |
| Native Windows provider/process probes | Seven tests pass, including descendant cleanup that preserves an unrelated session |
| Native Windows server ownership | Duplicate ownership rejection, verified endpoint, lease recovery after process kill, occupied-port cleanup, and atomic settings preservation pass |
| Packaged runtime | PDF upload/extraction, SQLite persistence, asset availability, renderer and preload loading pass |
| Tray acceptance | Hidden background answer, authenticated companion access, reopening, and keep/cancel quit paths pass |
| Persistence and single instance | Shared assistant setting, window/route preferences, invalid IPC rejection, and second-launch focus pass |
| Real provider integration | Codex 0.164.0 returned the expected fixed response through the packaged reader's HTTP chat route using account authentication |
| System Node independence | Packaged acceptance also passes with Node absent from PATH |
| Crash recovery | Forced backend termination, automatic restart, history restoration, and subsequent graceful cancellation/quit passed locally |

The deterministic alpha acceptance uses a compiled fake Claude provider. Real Codex was tested separately with `-LiveCodex`. These are distinct results; no fresh Claude login or live answer is claimed by this milestone.

The runtime now uses canonical database paths and OS-managed SQLite leases. An early full-suite concurrency run exceeded the original five-second startup wait under load. The dedicated startup lease now allows 15 seconds while ordinary writes retain their previous five-second busy timeout; the complete 114-test run subsequently passed.

The crash-recovery test exposed a shutdown delay from provider discovery and renderer requests. Discovery now receives the shutdown cancellation signal, and explicit Quit destroys the renderer before awaiting backend cleanup. The scenario then passed with a graceful backend exit rather than the force-stop fallback.

## Artifacts and user test

The local Windows executable is `%TEMP%\pdfpal-windows-m1\artifacts\win-unpacked\pdfpal Alpha.exe`. Keep the entire unpacked directory together. Closing it keeps it running; use the tray's Quit action before replacing it or returning to an older build.

A separate test launcher can select the existing M0 test library without changing the normal Windows CLI library. The normal executable uses the same Windows home/configuration conventions as the CLI. Windows and WSL default homes differ; cross-OS SQLite sharing is not a validated alpha workflow.

The installer, publisher signing, guided agent installation/login, automatic updates, and macOS/Linux distribution remain later milestones. Native notification appearance and a real Windows logout/login session remain manual user acceptance; automated tests check a temporary login registration without altering the user's existing startup preference.
