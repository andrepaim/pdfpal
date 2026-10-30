param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$Application,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$Manifest,
    [switch]$Signed,
    [string]$Publisher
)
$ErrorActionPreference = 'Stop'
foreach ($file in @($Application, $Installer)) {
    if (-not (Test-Path $file -PathType Leaf)) { throw 'Release artifact missing' }
    if ($Signed) {
        $signature = Get-AuthenticodeSignature $file
        if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) { throw 'Release requires a valid timestamped Authenticode signature' }
        $name = $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
        if (-not $name.Equals($Publisher, [StringComparison]::Ordinal)) { throw 'Release publisher does not match the configured identity' }
    }
}
$report = [ordered]@{
    format = 1; appId = 'io.pdfpal.desktop'; version = $Version; platform = 'win32'; arch = 'x64'; signed = [bool]$Signed
    publisher = $(if ($Signed) { $Publisher } else { $null })
    installer = [IO.Path]::GetFileName($Installer)
    sha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item $Installer).Length
}
[IO.File]::WriteAllText($Manifest, ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host $(if ($Signed) { 'Signed release verified.' } else { 'Unsigned preview built. This artifact is for testing.' })
