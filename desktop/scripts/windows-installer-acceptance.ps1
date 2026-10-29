param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$Baseline,
    [Parameter(Mandatory=$true)][string]$Candidate,
    [Parameter(Mandatory=$true)][string]$Version
)
$ErrorActionPreference = 'Stop'
# Verify fixture identity and bytes before allowing an installer to touch HKCU.
foreach ($file in @($Baseline, $Candidate)) {
    $manifest = Get-Content (Join-Path (Split-Path $file) 'pdfpal-desktop-release.json') -Raw | ConvertFrom-Json
    if ($manifest.appId -ne 'io.pdfpal.desktop.installer-acceptance' -or $manifest.signed -ne $false -or
        $manifest.installer -ne [IO.Path]::GetFileName($file) -or $manifest.sha256 -ne (Get-FileHash $file).Hash.ToLowerInvariant()) { throw 'Use only the generated, isolated installer acceptance fixtures.' }
}
$caseRoot = Join-Path $WorkRoot ("installer-acceptance-" + $PID)
$install = Join-Path $caseRoot "Reader's app"
$data = Join-Path $caseRoot 'library'
$profile = Join-Path $caseRoot 'profile'
$control = Join-Path $caseRoot 'control.json'
$snapshot = Join-Path $caseRoot 'library-snapshot.json'
$exe = Join-Path $install 'pdfpal-test.exe'
$appId = 'io.pdfpal.desktop.installer-acceptance'
$checks = New-Object 'System.Collections.Generic.List[string]'
$process = $null
$cli = $null
$cliControl = Join-Path $caseRoot "cli-control.json"
New-Item -ItemType Directory -Force -Path $caseRoot,$data | Out-Null
if (@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'pdfpal Installer Test' }).Count) { throw 'An installer acceptance build already exists. Remove that isolated test build before repeating acceptance.' }
function Launch([string]$File, [string]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File; $info.Arguments = $Arguments; $info.UseShellExecute = $false
    $info.WorkingDirectory = $caseRoot
    $p = New-Object System.Diagnostics.Process; $p.StartInfo = $info; $p.Start() | Out-Null
    return $p
}
function Finish($p, [int]$Timeout = 120000) {
    if (-not $p.WaitForExit($Timeout)) { throw 'Acceptance process timed out' }
    return $p.ExitCode
}
function Check([bool]$Condition, [string]$Name) { if (-not $Condition) { throw "Acceptance failed: $Name" }; $checks.Add($Name); Write-Host "Passed: $Name" }
function Install([string]$File) { $p = Launch $File ("/S /currentuser /D=" + $install); if ((Finish $p) -ne 0) { throw 'Per-user installer failed' } }
function Uninstaller { return @(Get-ChildItem $install -Filter 'Uninstall*.exe')[0].FullName }
function Snapshot([string]$Mode) {
    & node (Join-Path $SourceRoot 'desktop/scripts/installer-snapshot.mjs') (Join-Path $WorkRoot 'stage') $data $Mode $snapshot
    if ($LASTEXITCODE -ne 0) { throw 'Library preservation failed' }
}
function Start-Reader([string]$Label, [switch]$Hold) {
    $receipt = Join-Path $caseRoot "$Label.json"
    Remove-Item $receipt,$control -Force -ErrorAction SilentlyContinue
    $env:PDFPAL_DATA_DIR = $data; $env:PDFPAL_DB = Join-Path $data 'pdfpal.db'; $env:PDFPAL_DESKTOP_PROFILE = $profile
    $env:PDFPAL_INSTALLER_ACCEPTANCE_RECEIPT = $receipt; $env:PDFPAL_INSTALLER_ACCEPTANCE_CONTROL = $control
    $env:PDFPAL_M2_FAILURE_FIXTURE = '0'; $env:PDFPAL_M0_LIVE = '0'; $env:PDFPAL_M1_LIVE_CODEX = '0'
    $env:CLAUDE_BIN = Join-Path $WorkRoot 'fixture-provider.exe'; $env:PDFPAL_AGENT = 'claude'
    $p = Launch $exe $(if ($Hold) { '--installer-acceptance --installer-acceptance-hold' } else { '--installer-acceptance' })
    for ($i = 0; $i -lt 900; $i++) {
        if (Test-Path $receipt) { break }
        if ($p.HasExited) { throw "Installed reader exited early: $($p.ExitCode)" }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $receipt)) { throw 'Installed reader did not produce acceptance evidence' }
    $r = Get-Content $receipt -Raw | ConvertFrom-Json
    if ($r.status -ne 'passed') { throw 'Installed reader acceptance failed' }
    if (-not $Hold) { if ((Finish $p 30000) -ne 0) { throw 'Installed reader did not quit gracefully' } }
    return $p
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InstallerButtons {
  public delegate bool EnumCallback(IntPtr window, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  public static bool Click(int process, int button) {
    bool clicked = false;
    EnumWindows((window, extra) => { uint id; GetWindowThreadProcessId(window, out id);
      if (id == process && IsWindowVisible(window)) { IntPtr child = GetDlgItem(window, button); if (child != IntPtr.Zero) { PostMessage(child, 0x00F5, IntPtr.Zero, IntPtr.Zero); clicked = true; return false; } }
      return true; }, IntPtr.Zero);
    return clicked;
  }
}
'@
try {
    Install $Baseline
    Check (Test-Path $exe) 'fresh-per-user-install'
    $info = (Get-Item $exe).VersionInfo
    Check ($info.ProductName -eq 'pdfpal Installer Test' -and $info.FileDescription -eq 'pdfpal Installer Test') 'application-branding-and-version-resources'
    $shortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\pdfpal Installer Test.lnk'
    $shell = New-Object -ComObject WScript.Shell
    Check ((Test-Path $shortcut) -and $shell.CreateShortcut($shortcut).TargetPath -eq $exe) 'start-menu-shortcut'
    $process = Start-Reader 'baseline'
    Check ((Get-Content (Join-Path $caseRoot 'baseline.json') -Raw | ConvertFrom-Json).version -eq '2.1.0-preview.0') 'installed-app-launches-from-unrelated-directory'
    Snapshot 'save'
    $hash = (Get-FileHash $exe).Hash
    $dialog = Launch $Candidate '/currentuser'
    $clicked = $false
    for ($i = 0; $i -lt 100 -and -not $dialog.HasExited; $i++) { if ([InstallerButtons]::Click($dialog.Id, 2)) { $clicked = $true; break }; Start-Sleep -Milliseconds 100 }
    for ($i = 0; $i -lt 50 -and -not $dialog.HasExited; $i++) { [InstallerButtons]::Click($dialog.Id, 6) | Out-Null; Start-Sleep -Milliseconds 100 }
    if (-not $dialog.HasExited) { throw 'Could not cancel the installer wizard' }
    Check ($clicked -and (Get-FileHash $exe).Hash -eq $hash) 'cancelled-upgrade-keeps-existing-application'
    Snapshot 'check'
    $process = Start-Reader 'running' -Hold
    $blocked = Launch $Candidate ("/S /currentuser /D=" + $install)
    Check ((Finish $blocked) -ne 0 -and -not $process.HasExited -and (Get-FileHash $exe).Hash -eq $hash) 'upgrade-refuses-running-app-without-termination'
    $uninstall = Uninstaller
    $blocked = Launch $uninstall ('/S /currentuser _?=' + $install)
    $blockedCode = Finish $blocked
    Start-Sleep -Milliseconds 500
    Check ($blockedCode -ne 0 -and -not $process.HasExited -and (Test-Path $exe) -and (Get-FileHash $exe).Hash -eq $hash) 'uninstall-refuses-running-app-without-termination'
    [IO.File]::WriteAllText($control, '{"quit":true}')
    Check ((Finish $process 30000) -eq 0) 'graceful-quit-before-upgrade'
    Snapshot 'check'
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
    $startup = '"' + $exe + '" --hidden "--data-dir=' + $data + '" "--db=' + (Join-Path $data 'pdfpal.db') + '" "--profile=' + $profile + '"'
    New-ItemProperty $runKey -Name $appId -Value $startup -PropertyType String -Force | Out-Null
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $cliPort = $listener.LocalEndpoint.Port; $listener.Stop()
    $cliReady = Join-Path $caseRoot 'cli-ready.json'
    $wrapper = Join-Path $SourceRoot 'desktop/scripts/acceptance-cli.mjs'
    $node = (Get-Command node.exe).Source
    $cli = Launch $node ('"' + $wrapper + '" "' + (Join-Path $WorkRoot 'stage') + '" "' + $data + '" ' + $cliPort + ' "' + $cliReady + '" "' + $cliControl + '"')
    for ($i = 0; $i -lt 300 -and -not (Test-Path $cliReady); $i++) { if ($cli.HasExited) { throw 'Acceptance CLI exited early' }; Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path $cliReady)) { throw 'Acceptance CLI did not become ready' }
    Install $Candidate
    $health = Invoke-RestMethod ("http://127.0.0.1:" + $cliPort + "/api/health")
    Check (-not $cli.HasExited -and $health.status -eq 'ok') 'upgrade-preserves-running-cli-server'
    [IO.File]::WriteAllText($cliControl, '{"quit":true}')
    Check ((Finish $cli 30000) -eq 0) 'cli-server-quits-through-normal-signal-handler'
    Check ((Get-ItemProperty $runKey).$appId -eq $startup) 'upgrade-preserves-startup-preference'
    $process = Start-Reader 'upgraded'
    Check ((Get-Content (Join-Path $caseRoot 'upgraded.json') -Raw | ConvertFrom-Json).version -eq $Version) 'upgrade-runs-new-version'
    Snapshot 'check'
    $uninstall = Uninstaller
    $p = Launch $uninstall '/S /currentuser'
    Finish $p | Out-Null
    for ($i = 0; $i -lt 300; $i++) {
        $registered = @(Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq "pdfpal Installer Test" }).Count
        if (-not (Test-Path $exe) -and -not (Test-Path $shortcut) -and $registered -eq 0) { break }
        Start-Sleep -Milliseconds 100
    }
    Check (-not (Test-Path $exe) -and -not (Test-Path $shortcut)) 'uninstall-removes-application-and-shortcut'
    Check (-not ((Get-ItemProperty $runKey).PSObject.Properties.Name -contains $appId)) 'uninstall-removes-owned-startup-registration'
    Snapshot 'check'
    Check (Test-Path (Join-Path $profile 'desktop.json')) 'uninstall-retains-desktop-preferences'
    Install $Candidate
    $process = Start-Reader 'reinstalled'
    Snapshot 'check'
    Check ((Get-Content (Join-Path $profile 'desktop.json') -Raw | ConvertFrom-Json).setupComplete) 'reinstall-keeps-setup-and-library'
    $report = [ordered]@{ status = 'passed'; platform = 'win32'; fromVersion = '2.1.0-preview.0'; toVersion = $Version; checks = @($checks) }
    [IO.File]::WriteAllText((Join-Path $WorkRoot 'installer-receipt.json'), ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    $report | ConvertTo-Json -Depth 5
} finally {
    if ($cli -and -not $cli.HasExited) {
        [IO.File]::WriteAllText($cliControl, '{"quit":true}')
        if (-not $cli.WaitForExit(15000)) { & "$env:SystemRoot/System32/taskkill.exe" /PID $cli.Id /T /F | Out-Null }
    }
    if ($process -and -not $process.HasExited) {
        [IO.File]::WriteAllText($control, '{"quit":true}')
        if (-not $process.WaitForExit(15000)) { & "$env:SystemRoot/System32/taskkill.exe" /PID $process.Id /T /F | Out-Null }
    }
    if (Test-Path $exe) { $u = Uninstaller; $p = Launch $u '/S /currentuser'; Finish $p | Out-Null; for ($i = 0; $i -lt 300 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 100 } }
}
