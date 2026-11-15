# Linux desktop commands

Use `pdfpal-desktop-cli` for the running Linux desktop app. It uses Electron's bundled Node runtime and authenticated loopback HTTP; system Node is unnecessary for this launcher. The standalone `pdfpal` command remains separate and must not be substituted when the desktop connection is unavailable. Closing the Linux window quits the app, so keep it open during CLI work.

Start with:

```sh
pdfpal-desktop-cli --json status
pdfpal-desktop-cli --json doctor
pdfpal-desktop-cli --json library list
```

Capture the `library` fingerprint from status, check capabilities, and pass `--expect-library FINGERPRINT` on subsequent commands. If another desktop profile is intended, pass `--profile /absolute/profile/path` consistently, including on status. Do not use `PDFPAL_DATA_DIR` or `PDFPAL_DB` to redirect desktop commands; select the library in the app.

The command/flag table, receipts, pagination, operation recovery, note concurrency checks and exit codes in [desktop commands](windows.md) apply on Linux too. Replace `pdfpal --desktop` with `pdfpal-desktop-cli`; PowerShell encoding/request-file workarounds are Windows specific. Pass Linux paths for local PDFs and note files. Use quoted arguments, stdin or `--content-file` for Markdown without constructing executable shell text from document content.

For example, after obtaining the intended fingerprint and project UUID:

```sh
pdfpal-desktop-cli --json --expect-library FINGERPRINT source list PROJECT_UUID
pdfpal-desktop-cli --json --expect-library FINGERPRINT source text PROJECT_UUID SOURCE_UUID --page 4
```

For mutations, generate a UUID and use `--operation UUID --receipt`; retain it until the result is known. On connection loss, inspect `operation show UUID` before retrying. If the app is not running, open it from the application menu or with `pdfpal-desktop`; do not open SQLite directly as a workaround. Installed binaries live under the Debian package's application directory, with a `pdfpal-desktop-cli` command exposed on PATH.
