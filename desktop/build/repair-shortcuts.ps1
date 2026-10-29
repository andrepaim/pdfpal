param(
    [Parameter(Mandatory=$true)][string]$AppId,
    [string]$ProgramsDirectory = (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'),
    [string]$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
)
$ErrorActionPreference = 'Stop'
# Early unpacked alphas registered Electron.lnk with the production AppUserModelID.
# Windows can prefer that old name/icon over the installed pdfpal shortcut.
# Never remove another Electron app's shortcut, even if it shares the filename.
if ($AppId -ne 'io.pdfpal.desktop') { exit 0 }
$legacy = Join-Path $ProgramsDirectory 'Electron.lnk'
if (-not (Test-Path -LiteralPath $legacy -PathType Leaf)) { exit 0 }
try {
    $links = New-Object -ComObject WScript.Shell
    $link = $links.CreateShortcut($legacy)
    $target = [IO.Path]::GetFullPath($link.TargetPath)
    $known = @('pdfpal-alpha-m1', 'pdfpal-alpha-m2', 'pdfpal-alpha-m2-ui') | ForEach-Object {
        [IO.Path]::GetFullPath((Join-Path (Join-Path $LocalAppData $_) 'pdfpal Alpha.exe'))
    }
    $shell = New-Object -ComObject Shell.Application
    $item = $shell.Namespace($ProgramsDirectory).ParseName('Electron.lnk')
    if (($known -contains $target) -and $item.ExtendedProperty('System.AppUserModel.ID') -eq $AppId) {
        Remove-Item -LiteralPath $legacy -Force
        Write-Host 'Removed obsolete pdfpal alpha Start menu shortcut.'
    }
} catch {
    # A shortcut repair must not turn a completed installation into a failure.
    Write-Warning 'The obsolete alpha shortcut could not be inspected. The installed pdfpal shortcut is available in Start.'
}
