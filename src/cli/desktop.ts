import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Command, CommanderError } from 'commander'
import { DesktopConnection, desktopLibraries, type DesktopOptions } from './desktop-connection.js'
import { installSkill, skillStatus, uninstallSkill } from './skill-install.js'
import { print, readStdin, reportError } from './output.js'
import { PdfpalError } from '../core/types.js'
import { buildVersion } from '../shared/build-info.js'
import { CLI_PROTOCOL, type CliReceipt } from '../shared/cli-protocol.js'

export async function runDesktopCli(argv: string[]) {
  const program = new Command().name('pdfpal').description('Manage the running Windows pdfpal library')
    .version(buildVersion()).option('--desktop', 'connect to the Windows desktop app')
    .option('--request-file <filename>', 'read arguments from a UTF-8 JSON args array (must be the first option)')
    .option('--profile <directory>', 'explicit desktop profile (regular app by default)')
    .option('--library <id>', 'require a registered active library')
    .option('--expect-library <fingerprint>', 'reject a different library')
    .option('--json', 'emit JSON; errors go to stderr')
    .option('--receipt', 'return the complete mutation receipt')
    .option('--operation <uuid>', 'reuse this operation ID to inspect/retry the same mutation')
    .option('--retry', 'explicitly retry an interrupted or failed operation')
    .option('--no-wait', 'return an import/recovery receipt immediately')
    .option('--wait-ms <milliseconds>', 'maximum operation wait', '120000').exitOverride()
  if (argv.includes('--json')) program.configureOutput({ writeErr: () => {} })
  const emit = (value: any, command: Command) => print(!command.optsWithGlobals().json && value?.items ? value.items : value, Boolean(command.optsWithGlobals().json))
  const connect = (command: Command) => DesktopConnection.connect(command.optsWithGlobals() as DesktopOptions)
  const finish = (receipt: CliReceipt, command: Command) => {
    if (receipt.error) throw new PdfpalError(receipt.error.code, receipt.error.message, receipt.error.exitCode, { operationId: receipt.operationId, library: receipt.library, ...(receipt.error.details === undefined ? {} : { cause: receipt.error.details }) })
    emit(command.optsWithGlobals().receipt || receipt.state !== 'completed' || receipt.resultExpired ? receipt : receipt.result, command)
  }
  const wait = async (connection: DesktopConnection, receipt: CliReceipt, command: Command) => {
    const options = command.optsWithGlobals(), duration = Number(options.waitMs)
    if (!Number.isInteger(duration) || duration < 0 || duration > 600000) throw new PdfpalError('INVALID_WAIT', '--wait-ms must be between 0 and 600000.', 2)
    const deadline = Date.now() + duration
    while (receipt.state === 'running' && options.wait !== false && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
      receipt = await connection.request('/operations/' + encodeURIComponent(receipt.operationId), undefined, receipt.operationId)
    }
    finish(receipt, command)
  }
  program.command('status').description('identify the connected library and supported commands').action(async (_options, command) => {
    const connection = await connect(command)
    emit({ ...connection.status, transport: connection.transport, cliBuild: buildVersion(), libraryId: connection.selection.selected.id, label: connection.selection.selected.label, dataDir: connection.selection.selected.dataDir }, command)
  })
  program.command('doctor').description('check the launcher, library service and skill without changing data').action(async (_options, command) => {
    let connection: DesktopConnection | undefined, error: { code: string; message: string } | undefined
    try { connection = await connect(command) } catch (caught) { error = caught instanceof PdfpalError ? { code: caught.code, message: caught.message } : { code: 'SETUP_FAILED', message: 'Could not inspect the local setup.' } }
    const skill = skillStatus()
    const launcher = process.env.PDFPAL_CLI_LAUNCHER ?? process.argv[1]
    let commandResolution: string[] = []
    if (process.platform === 'win32') try {
      const result = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'), ['pdfpal'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      commandResolution = result.stdout.trim().split(/\r?\n/).filter(Boolean)
    } catch {}
    const pathReady = Boolean(launcher && commandResolution.some(item => path.resolve(item).toLowerCase() === path.resolve(launcher).toLowerCase()))
    const pathConflict = Boolean(commandResolution.length && launcher && path.resolve(commandResolution[0]!).toLowerCase() !== path.resolve(launcher).toLowerCase())
    emit({ ok: !!connection, cliBuild: buildVersion(), cliProtocol: CLI_PROTOCOL, command: launcher, commandResolution, pathReady, pathConflict, skill,
      ...(connection ? { transport: connection.transport, library: connection.status.library, libraryId: connection.selection.selected.id, label: connection.selection.selected.label, build: connection.status.build, schema: connection.status.schema } : { error }) }, command)
    if (!connection) process.exitCode = 1
  })
  program.command('library').command('list').action((_options, command) => {
    const { active, libraries } = desktopLibraries(command.optsWithGlobals())
    emit({ active, libraries }, command)
  })
  const skill = program.command('skill').description('manage the user-scoped ChatGPT/Codex skill')
  skill.command('status').action((_options, command) => emit(skillStatus(), command))
  skill.command('install').option('--replace', 'back up and replace an unmanaged or edited skill').option('--managed-only', 'update an unchanged managed installation only')
    .action((options, command) => emit(installSkill(options), command))
  skill.command('uninstall').action((_options, command) => emit(uninstallSkill(), command))
  const operation = program.command('operation').description('inspect a mutation without submitting it again')
  operation.command('show <id>').action(async (id, _options, command) => emit(await (await connect(command)).request('/operations/' + encodeURIComponent(id)), command))
  operation.command('wait <id>').action(async (id, _options, command) => {
    const connection = await connect(command)
    await wait(connection, await connection.request('/operations/' + encodeURIComponent(id)), command)
  })

  type Option = [string, string, string?]
  const paging: Option[] = [['--limit <number>', 'maximum results', '50'], ['--offset <number>', 'start offset', '0']]
  function register(parent: Command, syntax: string, action: string, positional: string[], options: Option[] = [], extra?: (local: any) => Promise<Record<string, unknown>> | Record<string, unknown>) {
    const command = parent.command(syntax)
    for (const [flags, description, initial] of options) command.option(flags, description, initial)
    command.action(async (...values: any[]) => {
      const self = values.at(-1) as Command, local = values.at(-2), globals = self.optsWithGlobals()
      const args: Record<string, unknown> = Object.fromEntries(positional.map((key, i) => [key, values[i]]).filter(([, value]) => value !== undefined))
      if (action.endsWith('.list') || action === 'highlights') { args.limit = Number(local.limit); args.offset = Number(local.offset) }
      if (extra) Object.assign(args, await extra(local))
      if (action === 'source.add') {
        const location = String(args.location); delete args.location
        if (/^https?:\/\//i.test(location)) args.url = location
        else args.file = { filename: path.basename(location), base64: fs.readFileSync(location).toString('base64') }
      }
      if (action === 'source.file' && args.collection === undefined) args.collection = null
      if (action === 'collection.move' && args.parent === undefined) args.parent = null
      if (action === 'collection.reorder') args.position = Number(args.position)
      if (action.endsWith('.delete') || action === 'source.remove') {
        if (!local.yes) throw new PdfpalError('CONFIRMATION_REQUIRED', 'Confirm the exact removal with --yes after the user authorizes it.', 2)
        args.yes = true
      }
      const connection = await connect(self)
      const mutation = !['search', 'highlights'].includes(action) && !['.list', '.show', '.text', '.verify'].some(suffix => action.endsWith(suffix))
      const id = mutation ? globals.operation ?? randomUUID() : undefined
      if (mutation && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new PdfpalError('INVALID_OPERATION_ID', 'Use a valid operation UUID.', 2)
      if (globals.retry && !globals.operation) throw new PdfpalError('OPERATION_ID_REQUIRED', 'Explicit retry requires --operation with the original UUID.', 2)
      const result = await connection.request('/command', { action, args, ...(id ? { operationId: id, retry: Boolean(globals.retry) } : {}) }, id)
      if (mutation) await wait(connection, result, self)
      else emit(result, self)
    })
    return command
  }
  const projects = program.command('project')
  register(projects, 'list', 'project.list', [], paging)
  register(projects, 'show <project>', 'project.show', ['project'])
  register(projects, 'create <title>', 'project.create', ['title'], [['-d, --description <text>', 'project description', '']], o => ({ description: o.description }))
  register(projects, 'rename <project> <title>', 'project.rename', ['project', 'title'])
  register(projects, 'delete <project>', 'project.delete', ['project'], [['-y, --yes', 'confirm deletion']])
  const sources = program.command('source')
  register(sources, 'list <project>', 'source.list', ['project'], paging)
  register(sources, 'show <project> <source>', 'source.show', ['project', 'source'])
  register(sources, 'text <project> <source>', 'source.text', ['project', 'source'], [['--page <number>', 'one marked page'], ['--offset <number>', 'text offset', '0'], ['--limit <number>', 'maximum characters', '8000']], o => ({ offset: Number(o.offset), limit: Number(o.limit), ...(o.page ? { page: Number(o.page) } : {}) }))
  register(sources, 'add <project> <location>', 'source.add', ['project', 'location'], [['-t, --title <text>', 'paper title'], ['-c, --collection <id>', 'target collection'], ['--allow-duplicate', 'import another copy']], async o => ({ ...(o.title ? { title: o.title } : {}), ...(o.collection ? { collection: o.collection } : {}), allowDuplicate: Boolean(o.allowDuplicate) }))
    .hook('preAction', async (_command, command) => {
      // Upload bytes from the caller's host; the service never reads arbitrary file paths.
      const location = command.args[1]!
      if (!/^https?:\/\//i.test(location)) {
        let stat: fs.Stats
        try { stat = fs.statSync(location) } catch { throw new PdfpalError('FILE_NOT_FOUND', 'The selected PDF file was not found.', 3) }
        if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new PdfpalError('INVALID_FILE', 'Choose a PDF file of at most 25 MB.', 2)
      }
    })
  register(sources, 'rename <project> <source> <title>', 'source.rename', ['project', 'source', 'title'])
  register(sources, 'move <project> <source> <target>', 'source.move', ['project', 'source', 'target'])
  register(sources, 'file <project> <source> [collection]', 'source.file', ['project', 'source', 'collection'], [], () => ({}))
  register(sources, 'remove <project> <source>', 'source.remove', ['project', 'source'], [['-y, --yes', 'confirm removal']])
  const collections = program.command('collection')
  register(collections, 'list <project>', 'collection.list', ['project'], paging)
  register(collections, 'create <project> <name>', 'collection.create', ['project', 'name'], [['-p, --parent <id>', 'parent collection']], o => o.parent ? { parent: o.parent } : {})
  register(collections, 'rename <project> <collection> <name>', 'collection.rename', ['project', 'collection', 'name'])
  register(collections, 'move <project> <collection> [parent]', 'collection.move', ['project', 'collection', 'parent'])
  register(collections, 'reorder <project> <collection> <position>', 'collection.reorder', ['project', 'collection', 'position'])
  register(collections, 'delete <project> <collection>', 'collection.delete', ['project', 'collection'], [['-y, --yes', 'confirm deletion']])
  const contentOptions: Option[] = [['-c, --content <text>', 'Markdown content'], ['--content-file <filename>', 'UTF-8 Markdown file']]
  async function content(o: any) {
    if (o.contentFile && o.content !== undefined) throw new PdfpalError('CONFLICTING_CONTENT', 'Choose --content or --content-file.', 2)
    if (o.contentFile) return fs.readFileSync(o.contentFile, 'utf8').replace(/^\uFEFF/, '')
    if (o.content !== undefined) return o.content
    if (process.stdin.isTTY) throw new PdfpalError('CONTENT_REQUIRED', 'Provide --content, --content-file, or pipe UTF-8 Markdown to stdin.', 2)
    return readStdin(false)
  }
  const notes = program.command('note')
  register(notes, 'list <project>', 'note.list', ['project'], paging)
  register(notes, 'show <project> <note>', 'note.show', ['project', 'note'])
  register(notes, 'create <project>', 'note.create', ['project'], [...contentOptions, ['-t, --title <text>', 'note title'], ['-s, --source <id>', 'attach to source']], async o => ({ content: await content(o), ...(o.title ? { title: o.title } : {}), ...(o.source ? { source: o.source } : {}) }))
  register(notes, 'edit <project> <note>', 'note.edit', ['project', 'note'], [...contentOptions, ['--expect-updated-at <timestamp>', 'reject changes since the note was read']], async o => ({ content: await content(o), ...(o.expectUpdatedAt ? { expectedUpdatedAt: o.expectUpdatedAt } : {}) }))
  register(notes, 'rename <project> <note> <title>', 'note.rename', ['project', 'note', 'title'], [['--expect-updated-at <timestamp>', 'reject changes since the note was read']], o => o.expectUpdatedAt ? { expectedUpdatedAt: o.expectUpdatedAt } : {})
  register(notes, 'delete <project> <note>', 'note.delete', ['project', 'note'], [['-y, --yes', 'confirm deletion']])
  register(program, 'search <project> <query>', 'search', ['project', 'query'], [['-l, --limit <number>', 'maximum passages', '16']], o => ({ limit: Number(o.limit) }))
  register(program, 'highlights <project>', 'highlights', ['project'], paging)
  const trash = program.command('trash')
  register(trash, 'list', 'trash.list', [], paging)
  register(trash, 'restore <id>', 'trash.restore', ['id'], [['--as-copy', 'restore with new identities']], o => ({ asCopy: Boolean(o.asCopy) }))
  const backups = program.command('backup')
  register(backups, 'list', 'backup.list', [], paging)
  register(backups, 'create', 'backup.create', [])
  register(backups, 'verify <id>', 'backup.verify', ['id'])
  program.hook('preAction', (_program, command) => {
    const duration = Number(command.optsWithGlobals().waitMs)
    if (!Number.isInteger(duration) || duration < 0 || duration > 600000) throw new PdfpalError('INVALID_WAIT', '--wait-ms must be between 0 and 600000.', 2)
  })
  try { await program.parseAsync(argv.length === 2 ? [...argv, '--help'] : argv) }
  catch (error) {
    if (error instanceof CommanderError) {
      if (!error.exitCode) return
      if (program.opts().json || argv.includes('--json')) reportError(new PdfpalError('CLI_ARGUMENT_ERROR', error.message.replace(/^error: /, ''), 2), true)
      process.exitCode = error.exitCode; return
    }
    reportError(error, Boolean(program.opts().json))
  }
}
