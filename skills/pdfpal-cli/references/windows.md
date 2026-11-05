# Windows desktop commands

Use the native Windows launcher. If PATH is stale, its regular installation is usually at `%LOCALAPPDATA%\Programs\pdfpal\bin\pdfpal.exe`; obtain the actual path from pdfpal's Command line & ChatGPT panel. Run in a session with local execution permissions. Keep pdfpal open in its tray.

For arguments containing embedded quotes or other arbitrary text, use `--request-file` to avoid Windows PowerShell 5's native argument rewriting. Write `{ "args": ["--desktop", "--json", ...] }` as UTF-8 JSON and run `& $cli --request-file $filename`. The CLI reads the array directly; it does not evaluate it as shell code. Include the library guard and operation UUID in that array. The WSL adapter uses this transport automatically. File content is limited to 8 MB; large notes should use a separate `--content-file`.

PowerShell example, using argument arrays rather than building a shell command from paper titles:

```powershell
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$cli = Join-Path $env:LOCALAPPDATA 'Programs\pdfpal\bin\pdfpal.exe'
$statusJson = & $cli --desktop --json status
if ($LASTEXITCODE -ne 0) { throw 'Check the connection error on stderr.' }
$status = $statusJson | ConvertFrom-Json
$scope = @('--desktop', '--json', '--expect-library', $status.library)
& $cli @scope project list
$operation = [guid]::NewGuid().ToString()
$created = & $cli @scope --receipt --operation $operation project create 'Attention mechanisms'
if ($LASTEXITCODE -ne 0) { throw 'Project creation failed; inspect its operation receipt.' }
$project = ($created | ConvertFrom-Json).result.id
$import = [guid]::NewGuid().ToString()
& $cli @scope --receipt --operation $import --no-wait source add $project 'https://arxiv.org/abs/1706.03762'
& $cli @scope operation show $import
```

| Command after global flags | Behavior |
| --- | --- |
| `status`, `doctor`, `library list` | Connection/capability diagnostics and registered libraries |
| `project list [--limit N --offset N]`, `project show ID` | Inspect projects |
| `project create TITLE [-d DESCRIPTION]`, `project rename ID TITLE` | Create or rename |
| `project delete ID --yes` | Delete the project and descendants; receipt contains `trashId` |
| `source list PROJECT`, `source show PROJECT SOURCE` | Compact source metadata |
| `source add PROJECT URL_OR_FILE [-t TITLE] [-c COLLECTION]` | Import or return an existing matching paper |
| `source text PROJECT SOURCE [--page N] [--offset N --limit N]` | Bounded text; default 8,000, maximum 20,000 characters |
| `source rename PROJECT SOURCE TITLE`, `source move PROJECT SOURCE TARGET_PROJECT` | Rename/move |
| `source file PROJECT SOURCE [COLLECTION]` | File/unfile a source |
| `source remove PROJECT SOURCE --yes` | Remove a paper with recovery reference |
| `collection list PROJECT`, `collection create PROJECT NAME [-p PARENT]` | Inspect/create collections |
| `collection rename PROJECT COLLECTION NAME` | Rename |
| `collection move PROJECT COLLECTION [PARENT]`, `collection reorder PROJECT COLLECTION POSITION` | Move/order |
| `collection delete PROJECT COLLECTION --yes` | Remove collections; papers become unfiled |
| `note list PROJECT`, `note show PROJECT NOTE` | Inspect notes |
| `note create PROJECT [-t TITLE] [-s SOURCE] --content-file FILE` | Save Markdown |
| `note edit PROJECT NOTE --content-file FILE --expect-updated-at TIMESTAMP` | Replace content with a concurrency check |
| `note rename PROJECT NOTE TITLE --expect-updated-at TIMESTAMP` | Rename with a concurrency check |
| `note delete PROJECT NOTE --yes` | Delete with recovery reference |
| `search PROJECT QUERY [--limit N]`, `highlights PROJECT` | Retrieve local evidence |
| `trash list`, `trash restore TRASH_ID [--as-copy]` | Inspect/recover deletions |
| `backup create`, `backup list`, `backup verify BACKUP_ID` | Full snapshots and integrity checks |

List commands and highlights accept `--limit`/`--offset`. Source text has its own character offset and limit. Unmarked text cannot supply reliable page citations; use source references and report that limitation.

Desktop JSON results are UTF-8. On Windows PowerShell 5, set the current session's `[Console]::OutputEncoding` as above before capturing Unicode output. For notes, avoid PowerShell 5's default file encoding:

```powershell
$file = Join-Path $env:TEMP ('pdfpal-note-' + [guid]::NewGuid().ToString() + '.md')
try {
  [IO.File]::WriteAllText($file, $markdown, [Text.UTF8Encoding]::new($false))
  $operation = [guid]::NewGuid().ToString()
  & $cli @scope --receipt --operation $operation note create $project --title 'Reading notes' --content-file $file
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
```

Success JSON goes to stdout; structured errors go to stderr. Exit codes: 0 success, 1 unexpected failure, 2 validation/confirmation, 3 missing resource/service, 4 conflict or uncertain operation outcome. A `running` receipt is an accepted operation, not completed work. `doctor` emits diagnostic JSON and exits nonzero when the connection is unavailable. A library fingerprint is local and changes when the database location changes.

`DESKTOP_NOT_RUNNING`: open pdfpal. `CLI_UPGRADE_REQUIRED`/`CLI_BUILD_MISMATCH`: update/restart the app and use its bundled CLI. `LIBRARY_MISMATCH`: re-establish the intended target. `CLI_CONNECTION_LOST`: inspect the operation ID in the error. `OPERATION_EXPIRED`: inspect the library; the completed operation will not execute again. Never use direct SQLite or direct Firebase writes to work around these failures.
