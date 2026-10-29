param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
try {
    if ($PSScriptRoot -notmatch '^[A-Za-z]:\\') { throw 'Copy this kit onto a local Windows drive first.' }
    $sandbox = Join-Path $env:SystemRoot 'System32/WindowsSandbox.exe'
    if (-not $PrepareOnly -and -not (Test-Path $sandbox)) { throw 'Windows Sandbox is not available. Use a fresh Windows account or VM, or enable Windows Sandbox separately in Windows Features.' }
    $payload = Join-Path $PSScriptRoot 'payload'
    $results = Join-Path $PSScriptRoot 'results'
    if (-not (Test-Path (Join-Path $payload 'Start test.cmd'))) { throw 'Extract the complete kit before starting Sandbox.' }
    New-Item -ItemType Directory -Force $results | Out-Null
    $inputPath = [Security.SecurityElement]::Escape($payload)
    $outputPath = [Security.SecurityElement]::Escape($results)
    $config = @"
<Configuration>
  <Networking>Enable</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MemoryInMB>8192</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$inputPath</HostFolder><SandboxFolder>C:\PDFPalTest</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$outputPath</HostFolder><SandboxFolder>C:\PDFPalResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>cmd.exe /d /c &quot;C:\PDFPalTest\Start test.cmd&quot;</Command></LogonCommand>
</Configuration>
"@
    $file = Join-Path $PSScriptRoot 'Fresh Windows test.wsb'
    [IO.File]::WriteAllText($file,$config,[Text.UTF8Encoding]::new($false))
    if (-not $PrepareOnly) { Start-Process -FilePath $sandbox -ArgumentList ('"' + $file + '"') }
} catch {
    if ($PrepareOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message,'pdfpal clean Windows test') | Out-Null
    exit 1
}
