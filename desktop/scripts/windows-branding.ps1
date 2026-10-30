param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$WorkRoot
)
$ErrorActionPreference = 'Stop'
$caseRoot = Join-Path $WorkRoot ('branding-' + $PID)
New-Item -ItemType Directory -Force $caseRoot | Out-Null
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = Join-Path $WorkRoot 'tools/node_modules/electron/dist/electron.exe'
if (-not (Test-Path $info.FileName)) {
    # Packaging installs tools with --ignore-scripts; obtain the pinned native
    # Electron only for this windowless shell/shortcut integration check.
    & node (Join-Path $WorkRoot 'tools/node_modules/electron/install.js')
    if ($LASTEXITCODE -ne 0) { throw 'Native branding test runtime installation failed' }
}
$fixture = Join-Path $SourceRoot 'desktop/test/branding.cjs'
$info.Arguments = '"' + $fixture + '" "' + $SourceRoot + '" "' + $caseRoot + '"'
$info.UseShellExecute = $false
$process = [Diagnostics.Process]::Start($info)
if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) { throw 'Branding fixture creation failed' }
$repair = Join-Path $SourceRoot 'desktop/build/repair-shortcuts.ps1'
& "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $repair -AppId 'io.pdfpal.desktop.installer-acceptance' -ProgramsDirectory (Join-Path $caseRoot 'owned') -LocalAppData (Join-Path $caseRoot 'local')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $caseRoot 'owned/Electron.lnk'))) { throw 'Isolated installer must not repair production shortcuts' }
# Repeating owned also verifies the repair is idempotent.
foreach ($case in @('owned', 'owned', 'foreign-target', 'foreign-id', 'similar-path')) {
    & "$env:SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $repair -AppId 'io.pdfpal.desktop' -ProgramsDirectory (Join-Path $caseRoot $case) -LocalAppData (Join-Path $caseRoot 'local')
    if ($LASTEXITCODE -ne 0) { throw 'Shortcut repair failed' }
    $exists = Test-Path (Join-Path (Join-Path $caseRoot $case) 'Electron.lnk')
    if ($exists -ne ($case -ne 'owned')) { throw "Shortcut ownership check failed: $case" }
    Write-Host "Passed shortcut ownership: $case"
}
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $SourceRoot 'desktop/build/icon.ico'
foreach ($size in @(16, 20, 24, 32, 40, 48, 64)) {
    $icon = New-Object Drawing.Icon($ico, $size, $size)
    $actual = $icon.ToBitmap()
    $reference = New-Object Drawing.Bitmap((Join-Path $caseRoot "$size-reference.png"))
    try {
        if ($actual.Width -ne $size -or $actual.Height -ne $size) { throw 'Wrong Windows icon dimensions' }
        $errorSum = 0L; $samples = 0
        for ($y = 0; $y -lt $size; $y++) { for ($x = 0; $x -lt $size; $x++) {
            $expected = $reference.GetPixel($x, $y); $pixel = $actual.GetPixel($x, $y)
            if ($expected.A -gt 200) {
                $errorSum += [Math]::Abs([int]$pixel.R - [int]$expected.R) + [Math]::Abs([int]$pixel.G - [int]$expected.G) + [Math]::Abs([int]$pixel.B - [int]$expected.B)
                $samples += 3
            }
        } }
        # Different Skia/GDI resamplers have slight edge differences; corrupted
        # PNG-as-DIB frames produce noise and fail this native visual comparison.
        if ($samples -eq 0 -or $errorSum / $samples -gt 20) { throw "Windows decoded a corrupted $size-pixel icon" }
        $actual.Save((Join-Path $caseRoot "$size-windows.png"))
        Write-Host ("Passed native Windows icon: {0}px, mean channel difference {1:N2}" -f $size, ($errorSum / $samples))
    } finally { $reference.Dispose(); $actual.Dispose(); $icon.Dispose() }
}
Write-Host "Branding evidence: $caseRoot"
