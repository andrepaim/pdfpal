param(
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [ValidateRange(1,100)][int]$StartupRuns = 20,
    [ValidateRange(1,100)][int]$TrayCycles = 50,
    [ValidateRange(1,300)][int]$IdleSeconds = 60
)
$ErrorActionPreference = 'Stop'
$artifact = Join-Path $WorkRoot 'beta-artifacts'
$receipt = Get-Content (Join-Path $artifact 'beta-build-receipt.json') -Raw | ConvertFrom-Json
$exe = Join-Path $artifact 'win-unpacked/pdfpal-test.exe'
if ($receipt.appId -ne 'io.pdfpal.desktop.installer-acceptance' -or $receipt.executable -ne 'pdfpal-test.exe' -or
    $receipt.sha256 -ne (Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant()) { throw 'Use only the isolated beta acceptance build' }
# .NET and Node can choose different TMP/TEMP priorities on hosted Windows.
# Use the same API as the packaged Node startup guard.
$nativeTemporary = & node -p "require('os').tmpdir()"
if ($LASTEXITCODE -ne 0 -or -not [IO.Path]::IsPathRooted($nativeTemporary)) { throw 'Native Node temporary directory unavailable' }
$caseRoot = Join-Path $nativeTemporary ('pdfpal-beta-' + [Guid]::NewGuid().ToString())
$data = Join-Path $caseRoot 'library'
$profile = Join-Path $caseRoot 'profile'
$control = Join-Path $caseRoot 'control.json'
$state = Join-Path $caseRoot 'state.json'
New-Item -ItemType Directory -Force $data,$profile | Out-Null
$script:reader = $null
$script:standardOutput = $null
$script:standardError = $null
$script:allPaintObserved = $true
$script:seen = @{}
$startup = New-Object 'System.Collections.Generic.List[double]'
$checks = New-Object 'System.Collections.Generic.List[string]'
$reportFile = Join-Path $WorkRoot 'beta-measurements.json'
Remove-Item -LiteralPath $reportFile -Force -ErrorAction SilentlyContinue
$phase = 'onboarding'
$completedCycles = 0
$startedAt = [DateTime]::UtcNow.ToString('o')
function Read-State {
    if (Test-Path $state) {
        try {
            # The producer atomically replaces this file. Default Get-Content
            # sharing on Windows can deny rename while the reader holds it.
            $stream = [IO.File]::Open($state, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            $text = New-Object IO.StreamReader($stream)
            try { return $text.ReadToEnd() | ConvertFrom-Json } finally { $text.Dispose() }
        } catch {}
    }
    return $null
}
function Remember-Tree {
    $all = @(Get-CimInstance Win32_Process -OperationTimeoutSec 10)
    $root = $all | Where-Object { $_.ProcessId -eq $script:reader.Id -and $_.ExecutablePath -eq $exe }
    if (-not $root) { throw 'Owned reader process disappeared' }
    $tree = @($root); $ids = @($root.ProcessId)
    do {
        $children = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids -and $_.CreationDate -ge $root.CreationDate })
        $tree += $children; $ids += @($children.ProcessId)
    } while ($children.Count -gt 0)
    foreach ($p in $tree) { $script:seen[[int]$p.ProcessId] = $p.CreationDate }
    return $tree
}
function Start-Reader([switch]$Missing) {
    Remove-Item $control,$state -Force -ErrorAction SilentlyContinue
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $exe; $info.Arguments = '--beta-acceptance'; $info.UseShellExecute = $false; $info.WorkingDirectory = $caseRoot
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($entry in @{
        PDFPAL_BETA_DIRECTORY=$caseRoot; PDFPAL_DATA_DIR=$data; PDFPAL_DB=(Join-Path $data 'pdfpal.db'); PDFPAL_DESKTOP_PROFILE=$profile;
        PDFPAL_PORT=[string]$port; PDFPAL_AGENT='claude'; PDFPAL_M0_LIVE='0'; PDFPAL_M1_LIVE_CODEX='0'; PDFPAL_FIXTURE_MODE='account';
        CLAUDE_BIN=$(if ($Missing) { Join-Path $caseRoot 'absent-claude.exe' } else { Join-Path $WorkRoot 'fixture-provider.exe' });
        CODEX_BIN=(Join-Path $caseRoot 'absent-codex.exe'); OPENCODE_BIN=(Join-Path $caseRoot 'absent-opencode.exe')
    }.GetEnumerator()) { $info.EnvironmentVariables[$entry.Key] = $entry.Value }
    # Never inherit a previous smoke/installer harness into this normal startup.
    foreach ($key in @('PDFPAL_M0_SMOKE','PDFPAL_M2_FAILURE_FIXTURE','PDFPAL_INSTALLER_ACCEPTANCE_RECEIPT','PDFPAL_INSTALLER_ACCEPTANCE_CONTROL')) { $info.EnvironmentVariables.Remove($key) }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $script:reader = [Diagnostics.Process]::Start($info)
    $script:standardOutput = $script:reader.StandardOutput.ReadToEndAsync()
    $script:standardError = $script:reader.StandardError.ReadToEndAsync()
    do {
        if ($script:reader.HasExited) { throw "Reader exited before usable UI ($($script:reader.ExitCode))" }
        $result = Read-State
        if ($result -and $result.state -eq 'ready') { break }
        if ($timer.Elapsed.TotalSeconds -gt 45) { throw "Usable library view timed out (phase: $($result.phase))" }
        Start-Sleep -Milliseconds 20
    } while ($true)
    $elapsed = $timer.Elapsed.TotalMilliseconds
    if ($result.version -ne $receipt.version -or -not $result.tray -or -not $result.visible) { throw 'Usable reader/tray or matching build version is missing' }
    if (-not $result.paintObserved) { $script:allPaintObserved = $false }
    $script:seen = @{}
    Remember-Tree | Out-Null
    return $elapsed
}
function Command([string]$Action) {
    $id = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllText($control + '.tmp', (@{id=$id;action=$Action} | ConvertTo-Json))
    Move-Item -LiteralPath ($control + '.tmp') -Destination $control -Force
    if ($Action -eq 'quit') { return }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $result = Read-State
        if ($result -and $result.id -eq $id) {
            if ($result.state -ne 'complete') { throw "Beta action failed: $Action" }
            return $result
        }
        if ($script:reader.HasExited -or $timer.Elapsed.TotalSeconds -gt 45) { throw "Beta action timed out: $Action" }
        Start-Sleep -Milliseconds 50
    } while ($true)
}
function Stop-Reader {
    Remember-Tree | Out-Null
    Command 'quit'
    if (-not $script:reader.WaitForExit(30000) -or $script:reader.ExitCode -ne 0) { throw 'Reader did not stop gracefully' }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $left = @(Get-CimInstance Win32_Process -OperationTimeoutSec 10 | Where-Object { $script:seen.ContainsKey([int]$_.ProcessId) -and $script:seen[[int]$_.ProcessId] -eq $_.CreationDate })
        if ($left.Count -eq 0) { return }
        if ($timer.Elapsed.TotalSeconds -gt 10) { throw 'Reader left owned descendants running' }
        Start-Sleep -Milliseconds 200
    } while ($true)
}
function Idle-Measurement {
    Command 'hide' | Out-Null
    Write-Host "Measuring tray resources after $IdleSeconds seconds idle..."
    Start-Sleep -Seconds $IdleSeconds
    $owned = @(Remember-Tree)
    if (@($owned | Where-Object { -not $_.ExecutablePath }).Count) { throw 'Owned process identity unavailable; do not report partial memory totals' }
    $tree = @($owned | Where-Object { $_.ExecutablePath -ne (Join-Path $WorkRoot 'fixture-provider.exe') })
    $ids = @($tree.ProcessId)
    $filter = ($ids | ForEach-Object { "IDProcess = $_" }) -join ' OR '
    $metrics = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter -OperationTimeoutSec 10)
    if ($metrics.Count -ne $ids.Count -or @($metrics | Where-Object { $null -eq $_.WorkingSetPrivate }).Count) { throw 'Complete private working-set counters unavailable' }
    $before = @{}
    foreach ($id in $ids) { $before[[int]$id] = (Get-Process -Id $id).TotalProcessorTime.TotalMilliseconds }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds 5
    $cpuMs = 0.0
    foreach ($id in $ids) { $cpuMs += [Math]::Max(0, (Get-Process -Id $id).TotalProcessorTime.TotalMilliseconds - $before[[int]$id]) }
    $duration = $clock.Elapsed.TotalMilliseconds
    $logical = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
    $privateMiB = ($metrics | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB
    return [ordered]@{
        scenario='sample-pdf-read-then-hidden'; idleSeconds=$IdleSeconds; appProcesses=$ids.Count;
        privateWorkingSetMiB=[Math]::Round($privateMiB,2); workingSetMiB=[Math]::Round((($metrics | Measure-Object WorkingSet -Sum).Sum / 1MB),2);
        privateBytesMiB=[Math]::Round((($metrics | Measure-Object PrivateBytes -Sum).Sum / 1MB),2);
        cpuPercentOfMachine=[Math]::Round(($cpuMs / $duration / $logical * 100),3); cpuSampleSeconds=[Math]::Round($duration/1000,2);
        memoryBudgetMiB=300; memoryWithinBudget=($privateMiB -le 300)
    }
}
try {
    [IO.File]::WriteAllText((Join-Path $profile 'desktop.json'), '{"version":1,"hideNotice":true}')
    Start-Reader -Missing | Out-Null
    $onboarding = Command 'setup'
    $checks.Add('explicit-missing-executable-setup-and-continue-without-ai')
    Stop-Reader
    Write-Host 'Passed isolated-profile missing-provider setup (not a clean Windows account).'
    $phase = 'startup'
    for ($run = 1; $run -le $StartupRuns; $run++) {
        $elapsed = Start-Reader
        $startup.Add([Math]::Round($elapsed,1))
        Write-Host ("Startup {0}/{1}: {2:N0} ms to usable home" -f $run,$StartupRuns,$elapsed)
        if ($run -lt $StartupRuns) { Stop-Reader }
    }
    Command 'prepare' | Out-Null
    Command 'cycle' | Out-Null # Seed actual PDF/answer/reader assets before idle.
    $phase = 'idle'
    $idle = Idle-Measurement
    $idle | ConvertTo-Json
    Stop-Reader
    $phase = 'tray'
    for ($cycle = 1; $cycle -le $TrayCycles; $cycle++) {
        Start-Reader | Out-Null
        Command 'prepare' | Out-Null
        Command 'cycle' | Out-Null
        # Real second launch must focus this window without creating a backend.
        $second = [Diagnostics.Process]::Start($script:reader.StartInfo)
        $secondOutput = $second.StandardOutput.ReadToEndAsync()
        $secondError = $second.StandardError.ReadToEndAsync()
        if (-not $second.WaitForExit(10000) -or $second.ExitCode -ne 0) { throw 'Second launch did not focus the existing instance' }
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            $shown = Command 'show'
            if ($shown.secondLaunches -ge 1) { break }
            Start-Sleep -Milliseconds 100
        }
        if ($shown.secondLaunches -lt 1) { throw 'Second launch was not observed' }
        $backends = @(Remember-Tree | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '--utility-sub-type=node\.mojom\.NodeService' })
        if ($backends.Count -ne 1) { throw 'Expected exactly one owned backend' }
        Stop-Reader
        $completedCycles = $cycle
        Write-Host "Passed tray cycle $cycle/$TrayCycles (background answer, reopen, second launch, graceful quit, no owned orphans)."
    }
    $checks.Add('repeated-background-answer-history-second-instance-and-graceful-quit')
    $sorted = @($startup | Sort-Object)
    $p95 = $sorted[[Math]::Ceiling(.95 * $sorted.Count) - 1]
    $os = Get-CimInstance Win32_OperatingSystem
    $machine = Get-CimInstance Win32_ComputerSystem
    $cpu = @(Get-CimInstance Win32_Processor)[0]
    $report = [ordered]@{
        format=1; status='functional-checks-passed'; startedAt=$startedAt; completedAt=[DateTime]::UtcNow.ToString('o'); performanceAcceptance='pending-reference-machine'; version=$receipt.version; platform='win32'; signed=$false; evidence='packaged-fixture-on-existing-development-account';
        machine=@{windows=$os.Caption;build=$os.BuildNumber;logicalProcessors=$machine.NumberOfLogicalProcessors;ramGiB=[Math]::Round($machine.TotalPhysicalMemory/1GB,1);cpu=$cpu.Name;referenceMachine=$false};
        startup=@{definition='fresh process launch to usable home DOM; frame observation reported separately; OS caches retained; setup/provider probes excluded';allFramesObserved=$script:allPaintObserved;runs=$StartupRuns;samplesMs=$startup.ToArray();p95Ms=$p95;targetMs=5000;withinBudget=($p95 -le 5000)};
        idle=$idle; tray=@{cycles=$TrayCycles;fixtureAnswersExpected=($TrayCycles+1);unrelatedProcessesTerminated=0};
        checks=$checks.ToArray(); cleanAccountAcceptance='pending'; realProviderLogin='pending'; publisherSigning='pending'
    }
    $report.idle.cpuWithinBudget = $report.idle.cpuPercentOfMachine -lt 1
    [IO.File]::WriteAllText($reportFile, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    $report | ConvertTo-Json -Depth 8
} catch {
    $failure = @{format=1;status='failed';version=$receipt.version;phase=$phase;completedStartups=$startup.Count;completedTrayCycles=$completedCycles;startedAt=$startedAt;completedAt=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText($reportFile, ($failure | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    throw
} finally {
    if ($script:reader -and -not $script:reader.HasExited) {
        try { Command 'quit' } catch {}
        if (-not $script:reader.WaitForExit(15000)) { & "$env:SystemRoot/System32/taskkill.exe" /PID $script:reader.Id /T /F | Out-Null }
    }
    if ($script:standardError -and $script:standardError.IsCompleted) { Write-Host $script:standardError.Result }
}
