param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [string]$WorkRoot = (Join-Path $env:TEMP 'pdfpal-windows-m1'),
    [switch]$SkipInstall,
    [switch]$SkipPackagedChecks,
    [int]$StartupRuns = 20,
    [int]$TrayCycles = 50,
    [int]$IdleSeconds = 60
)
$ErrorActionPreference = 'Stop'
if (-not $SkipPackagedChecks) {
    & "$PSScriptRoot/windows-m2.ps1" -SourceRoot $SourceRoot -WorkRoot $WorkRoot -SkipInstall:$SkipInstall
    if ($LASTEXITCODE -ne 0) { throw 'Packaged acceptance failed' }
}
foreach ($entry in Get-ChildItem (Join-Path $SourceRoot 'desktop/stage')) {
    if ($entry.Name -ne 'node_modules') { Copy-Item $entry.FullName (Join-Path $WorkRoot 'stage') -Recurse -Force }
}
Copy-Item (Join-Path $SourceRoot 'desktop/build') $WorkRoot -Recurse -Force
Copy-Item (Join-Path $SourceRoot 'desktop/electron-builder.yml') $WorkRoot -Force
& node (Join-Path $SourceRoot 'desktop/scripts/notices.mjs') (Join-Path $WorkRoot 'stage') $SourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Windows runtime notices failed' }
& node (Join-Path $SourceRoot 'desktop/scripts/package-beta.mjs') $WorkRoot
if ($LASTEXITCODE -ne 0) { throw 'Isolated beta packaging failed' }
& "$PSScriptRoot/windows-beta-measure.ps1" -WorkRoot $WorkRoot -StartupRuns $StartupRuns -TrayCycles $TrayCycles -IdleSeconds $IdleSeconds
