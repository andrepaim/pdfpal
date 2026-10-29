param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
try {
    $manifest = Get-Content (Join-Path $PSScriptRoot 'pdfpal-desktop-release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.appId -ne 'io.pdfpal.desktop' -or $manifest.installer -notmatch '^pdfpal-Setup-[0-9A-Za-z.-]+-x64\.exe$') { throw 'Invalid test installer metadata' }
    $installer = Join-Path $PSScriptRoot $manifest.installer
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256 -or (Get-Item $installer).Length -ne $manifest.size) { throw 'Installer verification failed; obtain a fresh test kit.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    $baseline = [ordered]@{
        windowsBuild=[int](Get-CimInstance Win32_OperatingSystem).BuildNumber;
        nodeOnPath=[bool](Get-Command node.exe -ErrorAction SilentlyContinue); npmOnPath=[bool](Get-Command npm -ErrorAction SilentlyContinue);
        gitOnPath=[bool](Get-Command git.exe -ErrorAction SilentlyContinue); claudeOnPath=[bool](Get-Command claude -ErrorAction SilentlyContinue); codexOnPath=[bool](Get-Command codex -ErrorAction SilentlyContinue);
        priorLibrary=(Test-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.pdfpal'));
        priorDesktopPreferences=(Test-Path (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'pdfpal-desktop'));
        elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
        installerSignatureStatus=[string]$signature.Status
    }
    $session = [ordered]@{version=$manifest.version;startedAt=[DateTime]::UtcNow.ToString('o');preflight=$baseline}
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('pdfpal-beta-recorder-' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $folder | Out-Null
    $template = Get-Content (Join-Path $PSScriptRoot 'Session recorder.html') -Raw -Encoding UTF8
    $html = $template.Replace('@@PDFPAL_SESSION@@', ($session | ConvertTo-Json -Depth 4 -Compress))
    [IO.File]::WriteAllText((Join-Path $folder 'Session recorder.html'), $html, [Text.UTF8Encoding]::new($false))
    if ($PrepareOnly) { Write-Output (Join-Path $folder 'Session recorder.html'); return }
    Start-Process -FilePath (Join-Path $folder 'Session recorder.html')
    Start-Process -FilePath $installer
} catch {
    if ($PrepareOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show('The test could not start. Verify that the complete kit is extracted and obtain a fresh copy if needed.', 'pdfpal beta test') | Out-Null
    exit 1
}
