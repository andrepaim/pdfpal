#!/usr/bin/env node
import { Command, Option } from 'commander'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import { loadConfig, type PdfpalConfig } from '../core/config.js'
import { buildVersion } from '../shared/build-info.js'
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
import { ExtensionAuth } from '../core/extension-auth.js'
import { saveContextualDefinitionsPreference } from '../core/config.js'
import { ETTIN_ENGLISH_INT8, inspectRuntime, installModel, installRuntime, platformTag, verifyModel } from '../core/sense-model.js'
import { SENSE_RUNTIME } from '../core/sense-runtime-manifest.js'
import { inspectInstall, modelTarget, runtimeTarget } from '../core/sense-download.js'

const program = new Command()
  .name('pdfpal')
  .description('Local reading assistant for PDFs and Kindle')
  .version(buildVersion())
  .option('--json', 'emit machine-readable JSON')
  .option('--data-dir <directory>', 'select an explicit standalone library')

let database: Database | undefined
let config: PdfpalConfig
program.hook('preAction', (_program, command) => {
  const directory = command.optsWithGlobals().dataDir
  config = loadConfig(directory ? { dataDir: path.resolve(directory), dbPath: path.join(path.resolve(directory), 'pdfpal.db') } : {})
})
const db = () => database ??= openDatabase(config)
const json = (command: Command) => Boolean(command.optsWithGlobals().json)

const cloud = program.command('cloud').description('manage optional Firebase library synchronization through the local server')
async function cloudRequest(route:string,body?:unknown){
  const {existingServer}=await import('../server/runtime.js')
  const origin=await existingServer(config.dbPath)
  if(!origin)throw new Error('Start pdfpal serve or the desktop app for this library first.')
  const response=await fetch(`${origin}/api/cloud/${route}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const result=await response.json() as any
  if(!response.ok)throw new Error(result.detail??'Cloud action failed')
  return result
}
cloud.command('status').action(async(_options,command)=>print(await cloudRequest('status'),json(command)))
cloud.command('sync').action(async(_options,command)=>print(await cloudRequest('sync',{}),json(command)))
cloud.command('login').action(async(_options,command)=>{const result=await cloudRequest('login',{});print(result,json(command));if(!json(command))await (await import('open')).default(result.url)})
cloud.command('logout').action(async(_options,command)=>print(await cloudRequest('logout',{}),json(command)))
cloud.command('pause').action(async(_options,command)=>print(await cloudRequest('pause',{paused:true}),json(command)))
cloud.command('resume').action(async(_options,command)=>print(await cloudRequest('pause',{paused:false}),json(command)))

const extension = program.command('extension').description('pair and manage the Kindle browser companion')
extension.command('pair').description('create a single-use pairing code valid for five minutes')
  .action((_options, command) => print(new ExtensionAuth(db()).pairCode(), json(command)))
extension.command('list').description('list paired browser connections')
  .action((_options, command) => print(new ExtensionAuth(db()).list(), json(command)))
extension.command('revoke').argument('<connection-id>').description('revoke a paired browser connection')
  .action((id, _options, command) => { new ExtensionAuth(db()).revoke(id); print({ revoked: id }, json(command)) })

program.command('serve')
  .description('start the local web application')
  .option('-p, --port <number>', 'port to bind', value => Number(value))
  .option('--no-open', 'do not open a browser')
  .option('--data-dir <directory>', 'open a separate library directory')
  .action(async options => {
    const directory=options.dataDir?path.resolve(options.dataDir):undefined
    const selected=directory?loadConfig({dataDir:directory,dbPath:path.join(directory,'pdfpal.db')}):config
    return startServer({ ...selected, port: options.port ?? selected.port }, { openBrowser: options.open })
  })

// Contextual definition order (English, opt-in). These commands touch only
// config.json and the library's models folder, never the database, and use
// no network. The desktop app reads the setting when it starts.
const dictionary = program.command('dictionary').description('set up contextual definition order for the reader (English, opt-in, local only)')
const printLines = (value: Record<string, unknown>, command: Command) => {
  if (json(command)) return print(value, true)
  const lines = (object: Record<string, unknown>, indent = ''): string[] => Object.entries(object).flatMap(([key, item]) =>
    item && typeof item === 'object' ? [`${indent}${key}:`, ...lines(item as Record<string, unknown>, `${indent}  `)] : [`${indent}${key}: ${item}`])
  print(lines(value).join('\n'))
}
dictionary.command('status').description('show the setting and verify the installed model and runtime')
  .action(async (_options, command) => {
    const model = await verifyModel(config.senseModelDir)
    printLines({
      contextual_definitions: config.contextualDefinitions, language: 'en', budget_ms: config.contextualDefinitionsBudgetMs,
      model: { directory: config.senseModelDir, name: ETTIN_ENGLISH_INT8.name, revision: ETTIN_ENGLISH_INT8.revision, status: model.ok ? 'verified' : model.code },
      runtime: { directory: config.senseRuntimeDir, name: SENSE_RUNTIME.name, platform: platformTag(), status: await inspectRuntime(config.senseRuntimeDir, SENSE_RUNTIME) },
      // Downloads from the reader's "Order meanings by context", shared by every library of this user.
      cache: {
        directory: config.senseCacheDir,
        model: await inspectInstall(modelTarget(config.senseCacheDir, ETTIN_ENGLISH_INT8)),
        runtime: await (async () => { const target = runtimeTarget(config.senseCacheDir, SENSE_RUNTIME, platformTag()); return target ? inspectInstall(target) : 'unsupported' })(),
      },
    }, command)
  })
dictionary.command('enable').description('order definitions by context (restart pdfpal to apply)')
  .action((_options, command) => { saveContextualDefinitionsPreference(config, true); printLines({ contextual_definitions: true }, command) })
dictionary.command('disable').description('show definitions in WordNet order (restart pdfpal to apply)')
  .action((_options, command) => { saveContextualDefinitionsPreference(config, false); printLines({ contextual_definitions: false }, command) })
dictionary.command('install-model').argument('<directory>', 'a local sense-model export of Ettin-150m-WSD (model_metadata.json, tokenizer files, onnx/model.int8.onnx)')
  .description('copy and verify the pinned English model into this library')
  .action(async (directory, _options, command) => printLines(await installModel(directory, config.senseModelDir), command))
dictionary.command('install-runtime').argument('<directory>', 'a directory whose node_modules holds onnxruntime-node and @huggingface/tokenizers at the pinned versions')
  .option('--platform <platform>', 'install the binaries for another platform, such as win32-x64 or linux-x64', platformTag())
  .description('copy and verify the pinned ONNX Runtime into this library, for the desktop app')
  .action(async (directory, options, command) => printLines(await installRuntime(directory, config.senseRuntimeDir, SENSE_RUNTIME, options.platform), command))

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
collection.command('reorder').argument('<project>').argument('<collection>').argument('<position>')
  .description('set a collection\'s 0-based sort position among its siblings')
  .action((p, c, position, _options, command) => print(new CollectionService(db()).reorder(p, c, Number(position)), json(command)))
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
    const content = options.content ?? await readStdin(false)
    print(new NoteService(db(), config).create(p, { title: options.title, content, sourceSelector: options.source }), json(command))
  })
note.command('rename').argument('<project>').argument('<note>').argument('<title>')
  .action((p, n, title, _options, command) => print(new NoteService(db(), config).update(p, n, { title }), json(command)))
note.command('edit').argument('<project>').argument('<note>').option('-c, --content <text>')
  .description('replaces a note\'s content; reads from stdin when --content is omitted')
  .action(async (p, n, options, command) => {
    const content = options.content ?? await readStdin(false)
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
  .action(async (p, question, options, command) => {
    const prompt = question ?? await readStdin()
    const result = await new ChatService(db(), config).ask(p, prompt, {
      sourceSelectors: options.source, collectionSelector: options.collection, agent: options.agent as AgentName | undefined,
      model: options.model,
    })
    print(json(command) ? result : result.answer, json(command))
  })

if (process.argv.length === 2) process.argv.push('serve')
program.parseAsync().catch(error => reportError(error, Boolean(program.opts().json))).finally(() => database?.close())
