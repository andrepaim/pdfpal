#!/usr/bin/env python3
"""Forward argv/stdin from WSL to the native Windows CLI without shell evaluation."""
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

def main():
    if not Path(POWERSHELL).is_file():
        print('pdfpal: Windows PowerShell is unavailable; use the native Windows host.', file=sys.stderr)
        return 3
    arguments = json.dumps({'args': sys.argv[1:], 'launcher': os.environ.get('PDFPAL_WINDOWS_CLI')}, ensure_ascii=True)
    script = r'''
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$payloadFile = '__ARGUMENT_FILE__'
$payload = [IO.File]::ReadAllText($payloadFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
$launcher = $payload.launcher
if (-not $launcher) { $launcher = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\pdfpal\bin\pdfpal.exe' }
if (-not [IO.Path]::IsPathRooted($launcher) -or -not (Test-Path -LiteralPath $launcher)) {
  [Console]::Error.WriteLine('pdfpal: The Windows CLI is missing. Update pdfpal and check Command line & ChatGPT.')
  exit 3
}
if ($env:PDFPAL_DATA_DIR -or $env:PDFPAL_DB) {
  [Console]::Error.WriteLine('pdfpal: Remove conflicting Windows PDFPAL_DATA_DIR/PDFPAL_DB before using desktop mode.')
  exit 2
}
function Quote-Argument([string]$value) {
  return '"' + [regex]::Replace([regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $launcher
$start.Arguments = '--request-file ' + (Quote-Argument $payloadFile)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [Diagnostics.Process]::Start($start)
$outputTask = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
$errorTask = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
$inputTask = [Console]::OpenStandardInput().CopyToAsync($process.StandardInput.BaseStream)
while (-not $process.HasExited) {
  if ($inputTask.IsCompleted) { try { $process.StandardInput.Close() } catch {} }
  [void]$process.WaitForExit(100)
}
[Threading.Tasks.Task]::WaitAll(@($outputTask, $errorTask))
exit $process.ExitCode
'''
    with tempfile.TemporaryDirectory(prefix='pdfpal-windows-') as directory:
        filename = Path(directory) / 'arguments.json'
        filename.write_text(arguments, encoding='utf-8')
        os.chmod(filename, 0o600)
        windows = subprocess.check_output(['wslpath', '-w', str(filename)], text=True).strip()
        script = script.replace('__ARGUMENT_FILE__', windows.replace("'", "''"))
        encoded = base64.b64encode(script.encode('utf-16le')).decode('ascii')
        return subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]).returncode

if __name__ == '__main__':
    sys.exit(main())
