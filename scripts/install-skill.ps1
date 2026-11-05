param([switch]$Replace, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $env:LOCALAPPDATA 'Programs\pdfpal\bin\pdfpal.exe'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Install the Windows pdfpal update with CLI support first.' }
$arguments = @('--desktop','--json','skill')
if ($Uninstall) { $arguments += 'uninstall' } else { $arguments += 'install'; if ($Replace) { $arguments += '--replace' } }
& $launcher @arguments
exit $LASTEXITCODE
