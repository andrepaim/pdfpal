Manage your Windows pdfpal library from ChatGPT

The Windows installer includes `pdfpal.exe` in its `bin` folder and adds that folder to your user PATH. It uses the bundled runtime, so no separate Node.js installation is required. The bundled command connects to the running desktop app and follows its selected library. Keep pdfpal open, including in its tray.

On Windows, commands use a private named pipe and prove the runtime's identity before sending the command credential. They do not allocate TCP ports. The reader and existing Firebase connection keep their current architecture. `status.transport` identifies the connection; the Windows launcher reports `windows-pipe`.

Open **pdfpal menu → Command line & ChatGPT**, choose **Install skill**, then **Check setup**. Start a new local ChatGPT conversation and select **pdfpal-cli** from Skills. Try: “Show my pdfpal projects and list the papers in one of them.” If an existing session cannot find the command, start a fresh terminal/chat or restart the host app so it sees the updated PATH. The setup panel shows the absolute command path as a fallback.

Standalone skills and execution permissions depend on your ChatGPT/Codex host. A local skill does not connect a browser-only conversation to your computer. Supported connected-PC workflows are configured separately. See [OpenAI skill guidance](https://learn.chatgpt.com/docs/build-skills) and [Windows host guidance](https://learn.chatgpt.com/docs/app/windows).

The first installation is user-scoped under `%USERPROFILE%\.agents\skills\pdfpal-cli`. Updates refresh unchanged managed copies; customized or legacy copies need explicit handling. `pdfpal skill install --replace` backs up an edited canonical copy before replacement. Backups live outside discoverable skill directories. The installer never changes the host's permission policy. The setup panel checks the connection; a successful request in ChatGPT verifies the complete workflow.

Useful PowerShell commands:

```powershell
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
pdfpal --desktop --json doctor
pdfpal --desktop --json status
pdfpal --desktop --json library list
pdfpal --desktop --json project list
```

JSON goes to stdout, errors to stderr. For a multi-step workflow, capture `status.library` and pass `--expect-library <fingerprint>` on subsequent calls. This prevents silently targeting a different library. Use `--library <registered-id>` to require a particular active registered library, or `--profile <directory>` for a separately configured installation. A closed app, inactive library, stale runtime or incompatible build produces a structured error. It never falls back to direct SQLite.

For arbitrary quoted text on Windows PowerShell 5, write a UTF-8 JSON file containing `{"args":["--desktop","--json",...]}` and invoke `pdfpal --request-file <filename>`. This bypasses shell argument rewriting while preserving each argument literally. The WSL adapter uses this transport automatically. No command text is evaluated as a shell script.

Use `--operation <UUID> --receipt` for writes. A completed receipt records the outcome; repeating the same operation and arguments returns that result. `--no-wait` returns an import/recovery operation immediately. Poll `operation show <UUID>` or use `operation wait <UUID>` before reporting completion. After an interruption, inspect the receipt; `--retry` explicitly retries a failed/interrupted operation with its original arguments and operation ID. Completed results expire after 30 days or the most recent 1,000 detailed receipts. Compact IDs/digests remain locally to prevent an expired completed operation from running again.

Desktop lists are paginated as `{items,total,offset,nextOffset}`. Source metadata and import results omit full PDF text; `source text` returns bounded text and optional marked pages. `search` searches already-indexed papers. The skill uses your agent's search tools to discover new papers, then imports their URLs or files. Imports deduplicate matching content unless `--allow-duplicate` is requested.

Notes accept UTF-8 stdin, `--content`, or `--content-file`. Read a note before changing it and pass `--expect-updated-at` with its `updated_at` timestamp. A conflicting edit keeps the Windows editor draft and offers reloading the saved note or saving the draft as a new note.

`project delete`, `source remove`, `collection delete` and `note delete` require `--yes`. The deletion receipt includes `trashId` for `trash restore <ID>`. `trash list` shows available recovery records. `backup create/list/verify` uses the existing full-library backup service. Full backup restoration remains in Backups & recovery and opens a separate recovered library.

From WSL, use the installed skill's `scripts/windows-cli.py` adapter. It forwards arguments and UTF-8 stdin to the native Windows CLI. Convert local PDF/content-file paths using `wslpath -w`. Linux `~/.pdfpal` and Windows `%USERPROFILE%\.pdfpal` are separate libraries; do not open the Windows SQLite database from Linux. An explicitly selected standalone CLI remains available through `--standalone --data-dir <directory>`.

Firebase sync continues through the existing outbox and Google session. Local operation receipts are excluded from sync. Existing diagnostic consent controls apply; shared error reports contain no arguments, titles, URLs, paths, PDF text, notes or credentials. This integration adds no hosted service, tunnel or OpenAI API key.
