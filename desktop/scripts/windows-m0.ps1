param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [string]$WorkRoot = (Join-Path $env:TEMP 'pdfpal-windows-m0'),
    [switch]$LiveProviders,
    [switch]$SkipInstall,
    [switch]$M1
)
$ErrorActionPreference = 'Stop'
function Run-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}
# Work on a Windows drive: cmd/npm do not reliably support a UNC working directory.
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$tools = Join-Path $WorkRoot 'tools'
$stage = Join-Path $WorkRoot 'stage'
New-Item -ItemType Directory -Force -Path $tools,$stage | Out-Null
Copy-Item (Join-Path $SourceRoot 'desktop/package.json') $tools -Force
Copy-Item (Join-Path $SourceRoot 'desktop/package-lock.json') $tools -Force
Copy-Item (Join-Path $SourceRoot 'desktop/electron-builder.yml') $WorkRoot -Force
foreach ($entry in Get-ChildItem (Join-Path $SourceRoot 'desktop/stage')) {
    if ($entry.Name -ne 'node_modules') { Copy-Item $entry.FullName $stage -Recurse -Force }
}
Push-Location $WorkRoot
try {
    if (-not $SkipInstall) {
        Run-Checked { npm.cmd ci --prefix $tools --ignore-scripts --no-audit --no-fund }
        Run-Checked { npm.cmd ci --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund }
    }
    Run-Checked { node (Join-Path $stage 'discovery.test.mjs') }
    Run-Checked { node (Join-Path $stage 'test/runtime.test.mjs') }
    Run-Checked { node (Join-Path $tools 'node_modules/electron-builder/cli.js') --config electron-builder.yml --win --x64 --dir }
    $env:PDFPAL_M0_RECEIPT = Join-Path $WorkRoot 'packaged-receipt.json'
    $env:PDFPAL_M0_LIVE = if ($LiveProviders) { '1' } else { '0' }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    Remove-Item $env:PDFPAL_M0_RECEIPT -ErrorAction SilentlyContinue
    $exe = Join-Path $WorkRoot 'artifacts/win-unpacked/pdfpal Alpha.exe'
    $env:PDFPAL_DESKTOP_PROFILE = Join-Path $WorkRoot 'smoke-profile'
    $env:PDFPAL_SETTINGS_PREVIEW = Join-Path $WorkRoot 'ai-settings.png'
    if ($M1) {
        $fixture = Join-Path $WorkRoot 'fixture-provider.exe'
        Remove-Item $fixture -ErrorAction SilentlyContinue
        $source = @'
using System;
using System.Threading;
public class FixtureProvider {
  public static void Main(string[] args) {
    if (args.Length > 0 && args[0] == "--version") { Console.WriteLine("1.0.0 (Claude Code)"); return; }
    if (args.Length > 0 && args[0] == "auth") { Console.WriteLine("{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}"); return; }
    Console.In.ReadToEnd(); Thread.Sleep(3000); Console.WriteLine("M1 background answer");
  }
}
'@
        if ($PSVersionTable.PSEdition -eq 'Core') {
            # Framework csc builds an executable that runs without a dotnet SDK/runtime install.
            $cs = Join-Path $WorkRoot 'FixtureProvider.cs'
            Set-Content $cs $source
            Run-Checked { & "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:exe "/out:$fixture" $cs }
        } else { Add-Type -TypeDefinition $source -OutputAssembly $fixture -OutputType ConsoleApplication }
        $env:CLAUDE_BIN = $fixture
        $env:PDFPAL_AGENT = 'claude'
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.Arguments = if ($M1) { '--m1-smoke' } else { '--m0-smoke' }
    $start.UseShellExecute = $false
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    $process.Start() | Out-Null
    if (-not $process.WaitForExit(300000)) { taskkill.exe /PID $process.Id /T /F; throw 'Packaged smoke timed out' }
    if ($process.ExitCode -ne 0) { throw "Packaged smoke failed: $($process.ExitCode)" }
    if (-not (Test-Path $env:PDFPAL_M0_RECEIPT)) { throw 'Packaged smoke receipt missing' }
    Get-Content $env:PDFPAL_M0_RECEIPT
    Remove-Item $env:PDFPAL_DESKTOP_PROFILE -Recurse -Force -ErrorAction SilentlyContinue
    # Prove the packaged runtime does not depend on a separately installed Node.
    $savedPath = $env:Path
    try {
        $env:PDFPAL_M0_LIVE = '0'
        $env:PDFPAL_M1_LIVE_CODEX = '0'
        $env:PDFPAL_M0_RECEIPT = Join-Path $WorkRoot 'no-system-node-receipt.json'
        Remove-Item $env:PDFPAL_M0_RECEIPT -ErrorAction SilentlyContinue
        $env:Path = Join-Path $env:SystemRoot 'System32'
        if (Get-Command node -ErrorAction SilentlyContinue) { throw 'Node still discoverable in restricted PATH' }
        $noNode = New-Object System.Diagnostics.Process
        $noNode.StartInfo = $start
        $noNode.Start() | Out-Null
        if (-not $noNode.WaitForExit(90000)) { taskkill.exe /PID $noNode.Id /T /F; throw 'No-system-Node smoke timed out' }
        if ($noNode.ExitCode -ne 0) { throw 'No-system-Node smoke failed' }
        Get-Content $env:PDFPAL_M0_RECEIPT
        Remove-Item $env:PDFPAL_DESKTOP_PROFILE -Recurse -Force -ErrorAction SilentlyContinue
    } finally { $env:Path = $savedPath }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    # Provider diagnostics use the same compiled adapter, under native Windows Node.
    Copy-Item (Join-Path $SourceRoot 'desktop/scripts/check-providers.mjs') (Join-Path $WorkRoot 'check-providers.mjs') -Force
    # The script expects ../../dist from its original repository location.
    $script = (Get-Content (Join-Path $WorkRoot 'check-providers.mjs') -Raw).Replace('../../dist/core/', './stage/dist/core/')
    Set-Content -Path (Join-Path $WorkRoot 'check-providers.mjs') -Value $script -Encoding UTF8
    node (Join-Path $WorkRoot 'check-providers.mjs')
    $providerExit = $LASTEXITCODE
    if ($providerExit -ne 0) { throw 'Some live provider gates remain unverified' }
    Write-Host "Desktop evidence and executable: $WorkRoot"
} finally { Pop-Location }
