param(
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][ValidateSet('install','uninstall')][string]$Action,
  [Parameter(Mandatory=$true)][string]$AppId
)
$ErrorActionPreference = 'Stop'
# Acceptance and preview installers must not change the regular CLI or skill.
if ($AppId -ne 'io.pdfpal.desktop') { exit 0 }
$bin = Join-Path ([IO.Path]::GetFullPath($InstallDirectory)) 'bin'
$command = Join-Path $bin 'pdfpal.exe'
$key = 'HKCU:\Software\pdfpal\CliIntegration'
$entries = @(([Environment]::GetEnvironmentVariable('Path','User') -split ';') | Where-Object { $_ })
function Same-Path([string]$Entry) { return $Entry.Trim('"').TrimEnd('\') -ieq $bin.TrimEnd('\') }
if ($Action -eq 'install') {
  if (-not (Test-Path -LiteralPath $command)) { throw 'The bundled CLI launcher is missing.' }
  if (-not ($entries | Where-Object { Same-Path $_ })) {
    [Environment]::SetEnvironmentVariable('Path', (($entries + $bin) -join ';'), 'User')
  }
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name 'PathEntry' -Value $bin
  & $command --desktop --json skill install --managed-only | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The existing skill could not be updated. Use Command line & ChatGPT in pdfpal to inspect setup.' }
} else {
  $owned = (Get-ItemProperty -Path $key -Name 'PathEntry' -ErrorAction SilentlyContinue).PathEntry
  if ($owned -and ($owned -ieq $bin)) {
    [Environment]::SetEnvironmentVariable('Path', (($entries | Where-Object { -not (Same-Path $_) }) -join ';'), 'User')
    Remove-ItemProperty -Path $key -Name 'PathEntry'
  }
  if (Test-Path -LiteralPath $command) { & $command --desktop --json skill uninstall | Out-Null }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PdfpalEnvironmentChange {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$result = [UIntPtr]::Zero
[void][PdfpalEnvironmentChange]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
