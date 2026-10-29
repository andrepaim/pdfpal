param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [string]$WorkRoot = (Join-Path $env:TEMP 'pdfpal-windows-m1'),
    [switch]$SkipInstall,
    [switch]$SkipPackagedChecks,
    [switch]$Signed
)
$ErrorActionPreference = 'Stop'
function Run-Checked([scriptblock]$Command) { & $Command; if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
if (-not $SkipPackagedChecks) {
    & "$PSScriptRoot/windows-m2.ps1" -SourceRoot $SourceRoot -WorkRoot $WorkRoot -SkipInstall:$SkipInstall
    if ($LASTEXITCODE -ne 0) { throw 'Packaged acceptance failed' }
}
$tools = Join-Path $WorkRoot 'tools'
$stage = Join-Path $WorkRoot 'stage'
foreach ($entry in Get-ChildItem (Join-Path $SourceRoot 'desktop/stage')) {
    if ($entry.Name -ne 'node_modules') { Copy-Item $entry.FullName $stage -Recurse -Force }
}
Copy-Item (Join-Path $SourceRoot 'desktop/build') $WorkRoot -Recurse -Force
Copy-Item (Join-Path $SourceRoot 'desktop/electron-builder.yml') $WorkRoot -Force
Run-Checked { node (Join-Path $SourceRoot 'desktop/scripts/notices.mjs') $stage $SourceRoot }
$version = (Get-Content (Join-Path $stage 'package.json') -Raw | ConvertFrom-Json).version
$build = Join-Path $SourceRoot 'desktop/scripts/build-installer.mjs'
if ($Signed) { Run-Checked { node $build "--project=$WorkRoot" "--tools=$tools" --signed } }
else { Run-Checked { node $build "--project=$WorkRoot" "--tools=$tools" } }
$baseline = Join-Path $WorkRoot 'installer-baseline'
$candidate = Join-Path $WorkRoot 'installer-candidate'
Run-Checked { node $build "--project=$WorkRoot" "--tools=$tools" --acceptance --version=2.1.0-preview.0 "--output=$baseline" }
Run-Checked { node $build "--project=$WorkRoot" "--tools=$tools" --acceptance "--version=$version" "--output=$candidate" }
& "$PSScriptRoot/windows-installer-acceptance.ps1" -SourceRoot $SourceRoot -WorkRoot $WorkRoot -Baseline (Join-Path $baseline 'pdfpal-Setup-2.1.0-preview.0-x64.exe') -Candidate (Join-Path $candidate "pdfpal-Setup-$version-x64.exe") -Version $version
if ($LASTEXITCODE -ne 0) { throw 'Installer acceptance failed' }
Write-Host "Installer ready: $(Join-Path $WorkRoot "artifacts/pdfpal-Setup-$version-x64.exe")"
