param(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$AppId,
    [switch]$RemoveStartup
)
$ErrorActionPreference = 'Stop'
try {
    $target = [IO.Path]::GetFullPath((Join-Path $InstallDirectory $Executable))
    if ($RemoveStartup) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true)
        if ($key) {
            try {
                $value = [string]$key.GetValue($AppId, '')
                if ($value.StartsWith('"' + $target + '"', [StringComparison]::OrdinalIgnoreCase) -or
                    $value.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or
                    $value.StartsWith($target + ' ', [StringComparison]::OrdinalIgnoreCase)) { $key.DeleteValue($AppId, $false) }
            } finally { $key.Dispose() }
        }
        exit 0
    }
    # Read-only check; never terminate a process by name or path.
    $escapedName = $Executable.Replace("'", "''")
    $running = @(Get-CimInstance Win32_Process -Filter "Name='$escapedName'" -OperationTimeoutSec 5 | Where-Object {
        $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($target, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count -gt 0) { exit 1618 }
    exit 0
} catch { exit 3 }
