# Linux desktop preview

The Linux desktop uses the same local-first reader, SQLite library, PDF extraction, Kindle companion, backups and optional cloud services as the other surfaces. The initial installer is a Debian package for x86-64, built with Electron 45. Mint 22/Ubuntu 24.04 with X11 is the initial validation environment. Wayland and other desktop environments still need interactive acceptance. AppImage and automatic Linux updates are deferred.

## Download or build

Download the `.deb`, `pdfpal-linux-release.json` and `SHA256SUMS-linux.txt` from an official [desktop engineering prerelease](https://github.com/andrepaim/pdfpal/releases). Coordinated releases use `desktop-v<version>` and include Windows and Linux from the same clean source revision and version. Keep the three Linux files in one directory and run `sha256sum -c SHA256SUMS-linux.txt` before installation. The earlier [2.8.0-beta.5.linux.1 preview](https://github.com/andrepaim/pdfpal/releases/tag/linux-desktop-v2.8.0-beta.5.linux.1) was published separately; see the [release pipeline](windows-release-pipeline.md) for the current process.

For newer engineering artifacts, open a successful [CI run](https://github.com/andrepaim/pdfpal/actions/workflows/ci.yml) for the intended `master` commit and download **pdfpal-linux-x64-preview** (GitHub sign-in may be required). The ZIP contains the Debian package, integrity manifest, checksums and acceptance receipts. Extract it and verify its checksums the same way. Ordinary CI artifacts do not publish a release. The coordinated release workflow publishes only after both platforms and all six release assets pass verification.

To build from a source checkout, use Node.js 22 or newer for development. The installed app and its bundled CLI do not need system Node.

```sh
npm ci
npm ci --prefix desktop
npm --prefix desktop run stage
npm ci --prefix desktop/stage --omit=dev --ignore-scripts
node desktop/scripts/notices.mjs desktop/stage .
npm --prefix desktop run package:linux
```

The output is `desktop/artifacts/pdfpal-<version>-amd64.deb` and `desktop/artifacts/linux-unpacked/`. These are unsigned engineering previews. Before distributing an artifact, generate integrity metadata with `node desktop/scripts/linux-release.mjs desktop/artifacts <source-commit-sha>` and verify `SHA256SUMS-linux.txt` from its artifact directory. Checksums establish file integrity; they do not establish publisher trust. Build provenance names the source commit; uncommitted local changes still require review.

Install a downloaded package with `sudo apt install ./pdfpal-<version>-amd64.deb`. Open **pdfpal** from the application menu, or run `pdfpal-desktop`. Read and import PDFs without signing in. The Debian package's dependencies are resolved by apt.

Electron's renderer sandbox remains enabled. Do not launch with `--no-sandbox`. Distribution policy may restrict unprivileged user namespaces for unpacked development applications. Use a distribution-approved, path-scoped AppArmor policy for that executable or an installed package with the appropriate sandbox permissions; do not disable system-wide security controls. CI records its narrow application policy in the workflow.

## Library, configuration and lifecycle

The shared default library stays at `~/.pdfpal`. Desktop configuration lives at `${XDG_CONFIG_HOME:-~/.config}/pdfpal-desktop`; a `PDFPAL_DESKTOP_PROFILE` or `--profile` override selects a separate profile. A profile registers its active library and authenticated local CLI endpoint. Avoid concurrently opening the same SQLite library from multiple app instances or standalone servers.

Linux keeps the window manager’s native title bar and controls, with the compact **pdfpal menu** toolbar inside the frame. The toolbar provides reading history, project search, cloud access and help, sharing the Windows app’s actions without drawing Windows caption buttons. **F10** opens the menu; arrow keys/Home/End navigate it and Escape closes it. **Ctrl+K** finds a project, **Alt+Left/Right** retraces reading history, **Ctrl+,** opens AI settings, and **Ctrl+Q** quits. Backups, privacy/diagnostics, CLI setup, Kindle, updates, licenses and **Start at login** are in this menu. The traditional native menu remains available during startup/recovery and is hidden when the reader’s shared menu is active. A tray icon is optional because support varies by desktop. Closing the Linux window quits safely rather than depending on an invisible tray icon. Background startup is opt-in under **Start at login**. It creates a user-owned XDG autostart desktop entry and removes only pdfpal's managed entry when disabled; the library remains intact. On Linux a login launch keeps a visible window available.

## Assistants and account protection

Open **AI settings**. Claude Code, Codex and OpenCode can be discovered in PATH and common per-user installation locations, including Node-managed installations. Linux installation/sign-in actions open official setup instructions; complete provider installation and sign-in in your terminal, then refresh discovery and explicitly test the connection. pdfpal never sources shell profiles or installs a provider silently. Node-script providers still require their own working Node runtime; this requirement belongs to the provider and is separate from the app's bundled CLI.

The same isolated, tool-restricted subprocess modes used by the existing reader apply on Linux. Discovery checks versions, required capabilities and available local sign-in status without generating an answer. External accounts and real provider generation are separate manual acceptance steps.

ChatGPT and Google cloud credentials require an unlocked secure OS credential store, such as GNOME Keyring/Secret Service. pdfpal refuses credential persistence if Electron cannot provide verified protected encryption. It never falls back to plaintext or Chromium's hardcoded Linux fallback key. Keyring cancellation, unavailable desktop services and unsupported ciphertext are recoverable account errors; local reading remains available. Real OAuth and keyring unlock/relogin need interactive verification on each supported desktop.

Cloud sync, saved-conversation sync, PDF transfers, telemetry and error reports retain their separate opt-ins. Signing in alone uploads no library content.

## Bundled CLI and npm coexistence

The package installs `pdfpal-desktop-cli` alongside the GUI executable. It runs through Electron's embedded Node runtime and connects to the selected running desktop library over authenticated loopback HTTP. It does not replace the standalone npm `pdfpal` command.

```sh
pdfpal-desktop-cli --json status
pdfpal-desktop-cli --json doctor
pdfpal-desktop-cli --json library list
pdfpal-desktop-cli skill install
```

Use `--profile /absolute/config/path` to select another desktop profile. Desktop mode rejects `PDFPAL_DATA_DIR`/`PDFPAL_DB` overrides: select the library in the app instead. Skill installation is explicit and user scoped. The standalone npm CLI continues to support its independent library/server workflow.

## Updates and removal

Linux software updates link to the release page for manual package selection. The signed Windows installer update channel is never consulted for Linux. Quit the app and install the newer Debian package with apt. Keep a verified backup before moving a library between versions. Do not open a library with a build older than its schema.

Remove the package with `sudo apt remove pdfpal-desktop`. Package removal retains your library and desktop preferences. Disable **Start at login** before removal. The uninstaller removes only its own CLI symlink; it does not delete npm's CLI, personal skills, `~/.pdfpal` or XDG configuration. Do not delete those locations unless you intend to remove your personal data.

## Automated acceptance

```sh
npm --prefix desktop test
node --test desktop/stage/discovery.test.mjs desktop/stage/test/runtime.test.mjs
# On an interactive display:
node desktop/scripts/linux-acceptance.mjs
# On CI with the required libraries, Xvfb, DBus and sandbox policy:
dbus-run-session -- xvfb-run -a node desktop/scripts/linux-acceptance.mjs
```

The packaged driver uses a temporary home, XDG directories, library and profile. It imports a real sample PDF, mounts the packaged reader, reopens SQLite, checks extension assets, starts the normal application, and checks the bundled CLI with a PATH containing no system Node. Its receipt explicitly lists outstanding manual gates. Live accounts, real assistants, interactive menus/tray and clean-machine Debian installation are not covered by that receipt.

For a real secure-storage check, first run `node desktop/node_modules/electron/install.js` after installing desktop dependencies (Electron 45 requires this explicit download), then run `node desktop/test/run-linux-vault-probe.mjs` on a display with DBus and `gnome-keyring-daemon` installed. It creates a private DBus session, temporary keyring and synthetic credentials, verifies the secure round trip, then verifies that Electron's basic fallback is rejected. It never uses your personal keyring or provider account. Keyring lock/unlock prompts and OAuth still require manual verification.
