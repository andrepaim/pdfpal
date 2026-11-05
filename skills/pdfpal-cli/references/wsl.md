# Operating the Windows library from WSL

Use the native Windows command through the bundled adapter. It transports argument arrays and stdin without shell interpolation; it does not open the Windows database from Linux.

```bash
python3 /path/to/this/skill/scripts/windows-cli.py --desktop --json status
python3 /path/to/this/skill/scripts/windows-cli.py --desktop --json --expect-library FINGERPRINT project list
```

The adapter discovers the regular launcher through Windows' LocalApplicationData folder. An explicitly selected installation can be provided through `PDFPAL_WINDOWS_CLI` as an absolute Windows path. Pass `--profile` explicitly for a separately registered test or preview profile. Keep Windows and WSL library identities distinct.

For Markdown, pipe UTF-8 text to the adapter or use `--content`. A `--content-file` path is interpreted on Windows; convert a WSL path with `wslpath -w` before passing it. The same applies to local PDF paths. Prefer an accessible native Windows file path for Windows imports.

The host needs Python 3 and WSL interoperability with Windows PowerShell. If that connection is unavailable, report it; do not substitute a standalone Linux library. Use the same library guard, UUID receipts, recovery and note-concurrency rules as the Windows reference.
