# Install pdfpal on a Mac

> **Experimental.** The Mac app is a port of the Windows desktop app and has passed automated packaging and start-up checks on a GitHub macOS runner, but has not yet been used by a person on a Mac. Expect rough edges, keep backups of your library, and report what you find. The [Mac desktop plan](mac-desktop-plan.md) lists what is done and what is still to be checked.

The Mac app is the same reader, library format and assistants as the Windows app. It includes its own runtime; you do not need to install Node.js to use it.

## Requirements

- A Mac with **Apple Silicon** (M1 or later). Check under **Apple menu → About This Mac**: the **Chip** line should name an Apple M-series chip. There is no Intel build.
- macOS 13 (Ventura) or later. That is the minimum Electron 45, the framework the app is built on, declares in the packaged app; it has not been confirmed by running the app on that version.

## Download and first launch

1. Open the [official release page](https://github.com/andrepaim/pdfpal/releases) and choose the newest `desktop-v…` release. Mac builds are published beside the Windows installer in the same release, marked **Pre-release**.
2. Download **pdfpal-…-arm64.dmg**. Do not download the `.exe`; that is the Windows installer.
3. Open the downloaded `.dmg` and drag **pdfpal** onto **Applications**. Run it from Applications, not from the disk image or Downloads: macOS runs apps from those places from a temporary read-only location.
4. Eject the disk image.

### Opening a build that is not notarized

Preview builds are not signed with an Apple Developer ID and are not notarized by Apple. macOS therefore blocks the first launch:

1. Open **pdfpal** from Applications. macOS says it cannot verify the app. Choose **Done** (not **Move to Trash**).
2. Open **System Settings → Privacy & Security** and scroll down to **Security**. Next to the message about pdfpal, choose **Open Anyway**.
3. Confirm with **Open Anyway** again and enter your Mac login password if asked.

Later launches open normally. You repeat these steps after installing a new preview build.

If **Open Anyway** is missing or disabled, your Mac may be managed by an organization that does not allow apps from unidentified developers. Ask whoever manages the Mac; do not try to work around the policy. Building the app yourself (see below) avoids the prompt but not the policy.

To check the download first, run this in Terminal from the download folder, using your file name, and compare the result with the matching line in that release's `SHA256SUMS.txt`:

```bash
shasum -a 256 pdfpal-2.9.0-beta.1-arm64.dmg
```

A matching checksum confirms the file arrived intact. It does not identify a publisher, because previews are unsigned.

## Start reading

1. In AI settings, choose an assistant (see below) or **Continue without AI**.
2. Create a project, import a PDF, select a passage and ask a question.

When you import a file by path from **Documents**, **Downloads** or **Desktop**, macOS may ask whether pdfpal may access that folder. Choosing a file with the file picker avoids most of these prompts.

## Closing and quitting

Closing the window does not quit pdfpal: the app keeps running and stays in the Dock, and an answer in progress keeps going. Click the Dock icon to reopen the window. To quit, press **Command-Q** or choose **Quit** from the pdfpal menu. Quitting saves pending note edits first.

## Where your library and settings live

- **Library:** `~/.pdfpal` (the `.pdfpal` folder in your home folder). This is the same folder the pdfpal command-line tool uses on a Mac, so both see the same library. It holds `pdfpal.db`, managed PDF copies in `files/` and backups in `backups/`.
- **App settings:** `~/Library/Application Support/pdfpal-desktop` holds window size and position, the last page you opened, and other app preferences.

Both are hidden by default in Finder. Press **Command-Shift-.** to show hidden files, or use **Go → Go to Folder…** and paste the path.

Removing or replacing the app keeps both folders. Keep the library on the Mac's own disk; sharing one live library file between computers or through a synced folder is not supported.

## Connecting an assistant

- **Claude Code or Codex already installed:** pdfpal looks for them in the usual install locations (for example `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`) and in your login shell's `PATH`. Installed assistants appear in AI settings with their version and sign-in state. If one you have installed is missing, choose **Check again**.
- **Not installed or not signed in:** the **Install** and **Sign in** actions open the provider's official guide in your browser. Follow it in Terminal, then return to pdfpal and choose **Check again**.
- **Continue with ChatGPT:** choose it in AI settings to sign in with your ChatGPT account in the browser and use eligible plan allowance without installing a coding agent.

Assistants run with your own account; provider usage limits apply, and pdfpal labels any mode that bills separately. As on Windows, assistants run with their tools disabled, because PDF text is untrusted.

## The pdfpal command

The pdfpal command lets you and local agents manage the library from Terminal. On a Mac, **pdfpal menu → Command line & ChatGPT** installs it as a link named `pdfpal` in `~/.local/bin`, without an administrator prompt, and warns if another `pdfpal` comes first on your `PATH`. If that folder is not on your `PATH`, add it in your shell profile (for example `export PATH="$HOME/.local/bin:$PATH"` in `~/.zshrc`).

If the panel reports that the command line is unavailable, the app could not find its bundled launcher; reinstall the app from the disk image.

## Known limits of an unsigned preview

- **The Keychain may ask for your password again after each update.** pdfpal stores saved sign-ins (such as Continue with ChatGPT) in the macOS Keychain. Unsigned builds have a different identity after every update, so macOS asks again whether pdfpal may read that item. Choose **Always Allow** if you trust the build.
- **Saved sign-ins may need reconnecting** after an update for the same reason. Sign in again from AI settings.
- **Folder access permissions may be asked again** after an update.
- **Check for updates does not offer Mac previews.** The in-app check only offers signed stable releases. No signed Mac build exists yet, so on a Mac it reports that no release is available. To update, download the newer `.dmg` from the release page, quit pdfpal with **Command-Q**, and drag the new **pdfpal** into Applications, replacing the old one. Your library is kept.

Signing with an Apple Developer ID and notarization would remove the first three limits and the Open Anyway step. They are not set up yet, so there is no stable Mac release.

## Uninstall

Quit pdfpal with **Command-Q**, then drag **pdfpal** from Applications to the Bin. Your library (`~/.pdfpal`) and app settings (`~/Library/Application Support/pdfpal-desktop`) are kept; delete them yourself only if you no longer need them, after making a backup.

## Build from source on a Mac

You need Node.js 22 or newer and git. Xcode is not needed.

```bash
git clone https://github.com/andrepaim/pdfpal.git
cd pdfpal
npm ci
node desktop/scripts/stage.mjs
node desktop/scripts/mac-build.mjs --work=/tmp/pdfpal-mac-build
```

`npm ci` also builds the server, reader and Kindle extension. `stage.mjs` assembles the app's runtime. `mac-build.mjs` installs the locked build tools, runs the native checks, packages the app, runs a smoke test of the packaged app, and writes the disk image and its manifest to `artifacts/` inside the work folder, and a test receipt (`packaged-receipt.json`) to the work folder itself. Open the `.dmg` from `artifacts/` and install it as described above. An app built on the same Mac, or fetched with `gh run download`, has no download flag, so it opens without the Open Anyway step.

## Get help

For support, open **Diagnostics**, review the preview and export the report. It contains versions, status and recent event codes, not document text, prompts, answers, credentials or full file paths. Include your pdfpal version, your macOS version and chip, what you clicked and what happened, and which assistant you use. Do not attach private PDFs, passwords, API keys or authentication files.
