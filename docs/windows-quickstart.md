# Install pdfpal on Windows

The desktop preview supports Windows 11 on an Intel/AMD 64-bit computer. It includes its own runtime; you do not need to install Node.js. The CLI remains a separate option.

## Install and start reading

1. Quit any running pdfpal window **from its tray menu**. Closing the window keeps it running.
2. Download the matching **pdfpal-Setup-…-x64.exe** desktop installer from the [official release page](https://github.com/andrepaim/pdfpal/releases). Engineering previews are marked **Pre-release** and may be unsigned; stable downloads require publisher signing.
3. Run the installer. It installs for your Windows user and creates a **pdfpal** Start menu entry. At the end, leave **Run pdfpal** selected.
4. In setup, choose Claude Code or Codex. If needed, use its **Install** or **Sign in** action, finish in the provider's window, close that window, and choose **Check again** in pdfpal. You need an eligible provider account; account usage limits apply. API credentials can charge separately, which pdfpal labels before use.
5. Optionally choose **Test connection** inside your selected assistant's card. It uses a short test prompt and your provider allowance. You can also choose **Continue without AI**.
6. Create a project, import a PDF, select a passage, and ask a question. PDF files, notes, highlights, and history are stored in your local library; relevant reading context is sent to your assistant's provider when you request an AI answer.

The current engineering installer is unsigned, so Windows may show an unknown-publisher/reputation prompt. Use it only as the test build supplied by the maintainer. A signed publisher identity is a gate for a public beta, not something this preview claims.

## Windows tray

Closing the reader keeps pdfpal running. Click its tray icon to reopen it. If the icon is hidden, open Windows' hidden-icons menu near the clock or enable pdfpal in taskbar tray settings. Use the tray's **Quit** action to save pending edits and stop the service. **Start with Windows** is optional and off by default.

The tray also offers **AI settings**, **Check for updates**, and **Diagnostics**. Connection testing belongs to the selected assistant; it is not another assistant choice.

## Your library and earlier alpha tests

The regular Windows application uses `%USERPROFILE%\.pdfpal`, matching the native Windows CLI. Upgrades replace application files and keep the library. Uninstall keeps the library and desktop preferences, so reinstalling can reopen them. Do not put your documents or a custom library inside the application's installation folder.

Earlier engineering launchers used a separate `%LOCALAPPDATA%\pdfpal-m0-test` library. That folder is retained; the regular Start menu entry uses the normal library. If you want to test against the earlier library, use the separately supplied **Open alpha test library.cmd** after installation. It selects that library for the launch and leaves the normal CLI configuration alone.

Windows and WSL use different home folders and default libraries. Sharing a live SQLite library between Windows and WSL is not a supported preview workflow.

## Upgrade or uninstall

**Stable releases.** Choose **Check for updates** in the tray to see your installed version and look for a newer signed stable release. This check only runs when requested. It reads GitHub release metadata and the manifest produced after the build verifies the publisher and timestamped Authenticode signatures. **Download installer** opens the installer URL in your browser. You quit pdfpal and run the installer yourself.

**Engineering previews.** The check skips prereleases, even when you are running one. To move from one preview to the next (for example, preview.4 to preview.5):

1. Open [GitHub Releases](https://github.com/andrepaim/pdfpal/releases), choose the target Windows desktop tag (for example, `desktop-v2.1.0-preview.5`), and download its `pdfpal-Setup-…-x64.exe`.
2. To check the download, run `Get-FileHash .\pdfpal-Setup-2.1.0-preview.5-x64.exe -Algorithm SHA256` in PowerShell from the download directory, substituting your installer filename. Compare the result with the entry in that release’s `SHA256SUMS.txt`. A matching checksum confirms file integrity. An unsigned preview has no verified publisher.
3. Save your work, choose **Quit** from the pdfpal tray menu, and run the installer under the same Windows account. It upgrades in place and keeps your library. Reopen pdfpal and use **Check for updates** to confirm the installed version.

If installation says pdfpal is running, save your work, quit it from the tray, and select **Retry**. Cancelling leaves the previous version in place. The installer does not force-stop your reading session or another CLI server.

Uninstall through Windows **Settings → Apps → Installed apps → pdfpal → Uninstall**. Quit pdfpal from the tray first. The app, its shortcut, and its own Windows-startup registration are removed; your library and preferences are kept.

## Get help

Start with **AI settings → Official setup guide** for assistant installation, login, or update issues. A startup recovery screen offers Retry when the local service cannot start. A running CLI server keeps ownership of its library; use its offered browser link or stop that server yourself before retrying the desktop app.

For support, open **Diagnostics**, review the preview, and export the report. It contains versions, status, and recent event codes, not document text, prompts, answers, credentials, or full personal file paths.

Include:

- Your pdfpal desktop version and Windows version.
- What you clicked and what happened.
- Whether you use Claude Code or Codex and whether sign-in/connection testing succeeds.
- The diagnostic report, after reviewing it.

Do not attach private PDFs, passwords, API keys, or authentication files. A useful short demonstration is: install → choose assistant → import a PDF → select a passage → ask → close to tray → reopen the completed answer.
