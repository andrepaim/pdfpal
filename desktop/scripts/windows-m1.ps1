param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [string]$WorkRoot = (Join-Path $env:TEMP 'pdfpal-windows-m1'),
    [switch]$SkipInstall,
    [switch]$LiveCodex
)
$env:PDFPAL_M1_LIVE_CODEX = if ($LiveCodex) { '1' } else { '0' }
& "$PSScriptRoot/windows-m0.ps1" -SourceRoot $SourceRoot -WorkRoot $WorkRoot -SkipInstall:$SkipInstall -M1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
