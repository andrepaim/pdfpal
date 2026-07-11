#!/usr/bin/env node
import { Command, Option } from 'commander'
import type { Database } from 'better-sqlite3'
import { loadConfig } from '../core/config.js'
import { openDatabase } from '../core/database.js'
import { ProjectService } from '../core/projects.js'
import { SourceService } from '../core/sources.js'
import { CollectionService } from '../core/collections.js'
import { NoteService } from '../core/notes.js'
import { RetrievalService } from '../core/retrieval.js'
import { listHighlights } from '../core/highlights.js'
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
source.command('add').argument('<project>').argument('<url-or-file>').option('-t, --title <text>').option('-c, --collection <collection>', 'file into a collection')
  .action(async (p, location, options, command) => print(await new SourceService(db(), config).add(p, location, options.title, options.collection), json(command)))
source.command('file').argument('<project>').argument('<source>').argument('[collection]')
  .description('file a source into a collection, or omit the collection to unfile it')
  .action((p, s, collection, _options, command) => print(new SourceService(db(), config).setCollection(p, s, collection ?? null), json(command)))
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

const collection = program.command('collection').description('organize sources into nested collections')
collection.command('list').argument('<project>').action((p, _options, command) => print(new CollectionService(db()).list(p), json(command)))
collection.command('create').argument('<project>').argument('<name>').option('-p, --parent <collection>', 'nest under a parent collection')
  .action((p, name, options, command) => print(new CollectionService(db()).create(p, name, options.parent), json(command)))
collection.command('rename').argument('<project>').argument('<collection>').argument('<name>')
  .action((p, c, name, _options, command) => print(new CollectionService(db()).rename(p, c, name), json(command)))
collection.command('move').argument('<project>').argument('<collection>').argument('[parent]')
  .description('reparent a collection, or omit the parent to move it to the top level')
  .action((p, c, parent, _options, command) => print(new CollectionService(db()).move(p, c, parent ?? null), json(command)))
collection.command('delete').argument('<project>').argument('<collection>').option('-y, --yes', 'skip confirmation')
  .action(async (p, c, options, command) => {
    const service = new CollectionService(db()); const found = service.resolve(p, c); const isJson = json(command)
    await confirm(`Delete collection "${found.name}" (its sources become unfiled)`, options.yes, isJson)
    print(service.delete(p, found.id), isJson)
  })

const note = program.command('note').description('manage project notes')
note.command('list').argument('<project>').action((p, _options, command) => print(new NoteService(db(), config).list(p).map(({ content: _, ...item }) => item), json(command)))
note.command('show').argument('<project>').argument('<note>').action((p, n, _options, command) => print(new NoteService(db(), config).resolve(p, n), json(command)))
note.command('create').argument('<project>').option('-t, --title <text>').option('-c, --content <text>').option('-s, --source <source>', 'attach to a source')
  .description('reads content from stdin when --content is omitted')
  .action(async (p, options, command) => {
    const content = options.content ?? await readStdin()
    print(new NoteService(db(), config).create(p, { title: options.title, content, sourceSelector: options.source }), json(command))
  })
note.command('rename').argument('<project>').argument('<note>').argument('<title>')
  .action((p, n, title, _options, command) => print(new NoteService(db(), config).update(p, n, { title }), json(command)))
note.command('edit').argument('<project>').argument('<note>').option('-c, --content <text>')
  .description('replaces a note\'s content; reads from stdin when --content is omitted')
  .action(async (p, n, options, command) => {
    const content = options.content ?? await readStdin()
    print(new NoteService(db(), config).update(p, n, { content }), json(command))
  })
note.command('delete').argument('<project>').argument('<note>').option('-y, --yes', 'skip confirmation')
  .action(async (p, n, options, command) => {
    const service = new NoteService(db(), config); const found = service.resolve(p, n); const isJson = json(command)
    await confirm(`Delete note "${found.title}"`, options.yes, isJson)
    print(service.delete(p, found.id), isJson)
  })

program.command('search').argument('<project>').argument('<query>').option('-l, --limit <number>', 'max passages', value => Number(value))
  .description('full-text search across a project\'s indexed source text')
  .action((p, query, options, command) => {
    const project = new ProjectService(db()).resolve(p)
    print(new RetrievalService(db()).search(project.id, query, [], options.limit ?? 20), json(command))
  })

program.command('highlights').argument('<project>')
  .description('list every annotation in a project, grouped by source')
  .action((p, _options, command) => print(listHighlights(db(), new ProjectService(db()).resolve(p).id), json(command)))

program.command('ask')
  .argument('<project>')
  .argument('[question]')
  .option('-s, --source <source...>', 'restrict context to one or more sources')
  .option('-c, --collection <collection>', 'restrict context to a collection subtree')
  .addOption(new Option('-a, --agent <agent>').choices(['claude', 'codex', 'opencode']))
  .option('-m, --model <model>')
  .option('--no-web', 'disable Tavily augmentation')
  .action(async (p, question, options, command) => {
    const prompt = question ?? await readStdin()
    const result = await new ChatService(db(), config).ask(p, prompt, {
      sourceSelectors: options.source, collectionSelector: options.collection, agent: options.agent as AgentName | undefined,
      model: options.model, searchWeb: options.web,
    })
    print(json(command) ? result : result.answer, json(command))
  })

if (process.argv.length === 2) process.argv.push('serve')
program.parseAsync().catch(error => reportError(error, Boolean(program.opts().json))).finally(() => database?.close())
