#!/usr/bin/env node
import { Command, Option } from 'commander'
import type { Database } from 'better-sqlite3'
import { loadConfig } from '../core/config.js'
import { openDatabase } from '../core/database.js'
import { ProjectService } from '../core/projects.js'
import { SourceService } from '../core/sources.js'
import { ChatService } from '../core/chat.js'
import type { AgentName } from '../core/agents.js'
import { confirm, print, readStdin, reportError } from './output.js'
import { startServer } from '../server/app.js'

const program = new Command()
  .name('pdfpal')
  .description('Local PDF research assistant')
  .version('2.0.0')
  .option('--json', 'emit machine-readable JSON')

let database: Database | undefined
const config = loadConfig()
const db = () => database ??= openDatabase(config)
const json = (command: Command) => Boolean(command.optsWithGlobals().json)

program.command('serve')
  .description('start the local web application')
  .option('-p, --port <number>', 'port to bind', value => Number(value))
  .option('--no-open', 'do not open a browser')
  .action(async options => startServer({ ...config, port: options.port ?? config.port }, { openBrowser: options.open }))

const project = program.command('project').description('manage projects')
project.command('list').action((_options, command) => print(new ProjectService(db()).list(), json(command)))
project.command('show').argument('<project>').action((selector, _options, command) => print(new ProjectService(db()).resolve(selector), json(command)))
project.command('create').argument('<title>').option('-d, --description <text>', 'project description', '')
  .action((title, options, command) => print(new ProjectService(db()).create(title, options.description), json(command)))
project.command('rename').argument('<project>').argument('<title>')
  .action((selector, title, _options, command) => print(new ProjectService(db()).rename(selector, title), json(command)))
project.command('delete').argument('<project>').option('-y, --yes', 'skip confirmation')
  .action(async (selector, options, command) => {
    const service = new ProjectService(db()); const found = service.resolve(selector); const isJson = json(command)
    await confirm(`Delete project "${found.title}" and all of its data`, options.yes, isJson)
    print(service.delete(found.id), isJson)
  })

const source = program.command('source').description('manage project sources')
source.command('list').argument('<project>').action((p, _options, command) => print(new SourceService(db(), config).list(p).map(({ pdf_text: _, ...item }) => item), json(command)))
source.command('show').argument('<project>').argument('<source>').action((p, s, _options, command) => print(new SourceService(db(), config).resolve(p, s), json(command)))
source.command('add').argument('<project>').argument('<url-or-file>').option('-t, --title <text>')
  .action(async (p, location, options, command) => print(await new SourceService(db(), config).add(p, location, options.title), json(command)))
source.command('rename').argument('<project>').argument('<source>').argument('<title>')
  .action((p, s, title, _options, command) => print(new SourceService(db(), config).rename(p, s, title), json(command)))
source.command('move').argument('<project>').argument('<source>').argument('<target-project>')
  .action((p, s, target, _options, command) => print(new SourceService(db(), config).move(p, s, target), json(command)))
source.command('remove').argument('<project>').argument('<source>').option('-y, --yes', 'skip confirmation')
  .action(async (p, s, options, command) => {
    const service = new SourceService(db(), config); const found = service.resolve(p, s); const isJson = json(command)
    await confirm(`Remove source "${found.title ?? found.id}"`, options.yes, isJson)
    print(service.remove(p, found.id), isJson)
  })
source.command('reindex').argument('<project>').argument('[source]').option('--refetch', 'download or read the PDF again')
  .action(async (p, s, options, command) => print({ chunks_indexed: await new SourceService(db(), config).reindex(p, s, options.refetch) }, json(command)))

program.command('ask')
  .argument('<project>')
  .argument('[question]')
  .option('-s, --source <source...>', 'restrict context to one or more sources')
  .addOption(new Option('-a, --agent <agent>').choices(['claude', 'codex', 'opencode']))
  .option('-m, --model <model>')
  .option('--no-web', 'disable Tavily augmentation')
  .action(async (p, question, options, command) => {
    const prompt = question ?? await readStdin()
    const result = await new ChatService(db(), config).ask(p, prompt, {
      sourceSelectors: options.source, agent: options.agent as AgentName | undefined,
      model: options.model, searchWeb: options.web,
    })
    print(json(command) ? result : result.answer, json(command))
  })

if (process.argv.length === 2) process.argv.push('serve')
program.parseAsync().catch(error => reportError(error, Boolean(program.opts().json))).finally(() => database?.close())
