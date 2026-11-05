param(
  [Parameter(Mandatory=$true)][string]$Output,
  [string]$ApplicationExecutable = 'pdfpal.exe'
)
$ErrorActionPreference = 'Stop'
if ($ApplicationExecutable -notmatch '^[a-zA-Z0-9-]+\.exe$') { throw 'Invalid application executable name.' }
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pdfpal-cli.cs')).Replace('__PDFPAL_EXECUTABLE__', $ApplicationExecutable)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Output))) | Out-Null
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output }
Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $Output -OutputType ConsoleApplication -ReferencedAssemblies 'System.dll','System.Core.dll'
