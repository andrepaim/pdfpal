import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import net from 'node:net'
import {once} from 'node:events'

function runCli(dataDir: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, ['dist/cli/index.js', ...args], {
    cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir, ...extraEnv }, encoding: 'utf8',
  })
}

test('compiled CLI supports JSON project workflows', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-'))
  try {
    const created = JSON.parse(runCli(dataDir, ['project', 'create', 'CLI Project', '--json'])) as { id: string; title: string }
    assert.equal(created.title, 'CLI Project')
    const listed = JSON.parse(runCli(dataDir, ['project', 'list', '--json'])) as Array<{ id: string }>
    assert.equal(listed[0]?.id, created.id)
    assert.equal(JSON.parse(runCli(dataDir, ['project', 'show', created.id, '--json'])).id, created.id)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI supports source lifecycle and project moves', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-source-'))
  try {
    runCli(dataDir, ['project', 'create', 'From', '--json'])
    runCli(dataDir, ['project', 'create', 'To', '--json'])
    const source = JSON.parse(runCli(dataDir, ['source', 'add', 'From', path.resolve('test/fixtures/sample.pdf'), '--title', 'Paper', '--json'])) as { id: string }
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'list', 'From', '--json'])).length, 1)
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'rename', 'From', source.id, 'Renamed', '--json'])).title, 'Renamed')
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'reindex', 'From', source.id, '--json'])).chunks_indexed, 2)
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'move', 'From', source.id, 'To', '--json'])).project_id,
      JSON.parse(runCli(dataDir, ['project', 'show', 'To', '--json'])).id)
    runCli(dataDir, ['source', 'remove', 'To', source.id, '--yes', '--json'])
    assert.deepEqual(JSON.parse(runCli(dataDir, ['source', 'list', 'To', '--json'])), [])
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI returns structured errors and stable exit codes', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-error-'))
  try {
    const result = spawnSync(process.execPath, ['dist/cli/index.js', 'project', 'show', 'missing', '--json'], {
      cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8',
    })
    assert.equal(result.status, 3)
    assert.equal(JSON.parse(result.stderr).error.code, 'PROJECT_NOT_FOUND')
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI ask help has no Tavily web-search option', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-help-'))
  try {
    const help = runCli(dataDir, ['ask', '--help'])
    assert.equal(help.includes('--no-web'), false)
    assert.equal(help.includes('Tavily'), false)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI rejects the removed web-search option', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-no-web-'))
  try {
    const result = spawnSync(process.execPath, ['dist/cli/index.js', 'ask', 'missing', 'question', '--no-web'], {
      cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown option '--no-web'/)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('serve --data-dir opens the selected recovery library even when startup env points at the original DB',{timeout:15000},async()=>{
 const original=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-cli-original-')),recovered=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-cli-recovered-'))
 let child:ReturnType<typeof spawn>|undefined
 try{
  runCli(original,['project','create','Original library','--json'])
  runCli(recovered,['project','create','Recovery library','--json'])
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()))
  child=spawn(process.execPath,['dist/cli/index.js','serve','--data-dir',recovered,'--port',String(port),'--no-open'],{env:{...process.env,PDFPAL_DATA_DIR:original,PDFPAL_DB:path.join(original,'pdfpal.db')},stdio:'ignore'})
  let response:Response|undefined
  for(let i=0;i<200;i++){try{response=await fetch(`http://127.0.0.1:${port}/api/projects`);if(response.ok)break}catch{};await new Promise(resolve=>setTimeout(resolve,25))}
  assert.ok(response?.ok);assert.deepEqual((await response!.json() as {title:string}[]).map(p=>p.title),['Recovery library'])
  assert.deepEqual((JSON.parse(runCli(original,['project','list','--json'])) as {title:string}[]).map(p=>p.title),['Original library'])
 }finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited}fs.rmSync(original,{recursive:true,force:true});fs.rmSync(recovered,{recursive:true,force:true})}
})

test('compiled CLI reports, enables and provisions contextual definitions without a network', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-dictionary-'))
  const env = { PDFPAL_CONTEXTUAL_DEFINITIONS: '', PDFPAL_SENSE_MODEL_DIR: '', PDFPAL_SENSE_RUNTIME_DIR: '', PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS: '' }
  try {
    const status = JSON.parse(runCli(dataDir, ['dictionary', 'status', '--json'], env))
    assert.deepEqual(status, { contextual_definitions: false, language: 'en', budget_ms: 120, model: { directory: path.join(dataDir, 'models', 'ettin-150m-wsd-int8'), name: 'Ettin-150m-WSD dynamic INT8 ONNX', revision: '8751b577199d1bb95b74fa2457da7065d57100ae', status: 'MODEL_MISSING' }, runtime: { directory: path.join(dataDir, 'models', 'sense-runtime'), name: 'onnxruntime-node 1.30.0 with @huggingface/tokenizers 0.2.0', platform: `${process.platform}-${process.arch}`, status: 'bundled' } })

    assert.deepEqual(JSON.parse(runCli(dataDir, ['dictionary', 'enable', '--json'], env)), { contextual_definitions: true })
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).contextual_definitions, true)
    assert.equal(JSON.parse(runCli(dataDir, ['dictionary', 'status', '--json'], env)).contextual_definitions, true)
    assert.deepEqual(JSON.parse(runCli(dataDir, ['dictionary', 'disable', '--json'], env)), { contextual_definitions: false })

    // A directory without the pinned files is refused with a stable code.
    const source = path.join(dataDir, 'not-a-model')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'model_metadata.json'), '{}')
    const refused = spawnSync(process.execPath, ['dist/cli/index.js', 'dictionary', 'install-model', source, '--json'], { cwd: path.resolve('.'), env: { ...process.env, ...env, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8' })
    assert.equal(refused.status, 2)
    assert.equal(JSON.parse(refused.stderr).error.code, 'MODEL_MISSING')
    assert.equal(fs.existsSync(path.join(dataDir, 'models', 'ettin-150m-wsd-int8')), false)

    // The packaged desktop CLI (PDFPAL_CLI_DESKTOP=1) runs these commands locally
    // instead of asking the app, also after global options, and honours an explicit library.
    const packaged = { ...env, PDFPAL_CLI_DESKTOP: '1' }
    assert.equal(JSON.parse(runCli(dataDir, ['dictionary', 'status', '--json'], packaged)).language, 'en')
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-dictionary-other-'))
    try {
      for (const args of [['--data-dir', other, 'dictionary', 'status', '--json'], ['--json', '--data-dir', other, 'dictionary', 'status'], [`--data-dir=${other}`, '--json', 'dictionary', 'status']]) {
        assert.equal(JSON.parse(runCli(dataDir, args, packaged)).model.directory, path.join(other, 'models', 'ettin-150m-wsd-int8'), args.join(' '))
      }
      runCli(dataDir, ['--json', '--data-dir', other, 'dictionary', 'enable'], packaged)
      assert.equal(JSON.parse(fs.readFileSync(path.join(other, 'config.json'), 'utf8')).contextual_definitions, true)
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).contextual_definitions, false, 'the default library is untouched')
    } finally { fs.rmSync(other, { recursive: true, force: true }) }
    // Other commands keep their routing: the packaged CLI still sends them to the desktop dispatcher.
    for (const args of [['--data-dir', dataDir, 'project', 'list', '--json'], ['--profile', 'default', 'dictionary', 'status', '--json']]) {
      const routed = spawnSync(process.execPath, ['dist/cli/index.js', ...args], { cwd: path.resolve('.'), env: { ...process.env, ...packaged, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8' })
      assert.notEqual(routed.status, 0, args.join(' '))
      assert.equal(JSON.parse(routed.stderr).error.code, 'CLI_ARGUMENT_ERROR', 'rejected by the desktop dispatcher, as before')
    }
    // A runtime for another platform can be provisioned, here from this checkout's node_modules.
    const runtime = JSON.parse(runCli(dataDir, ['dictionary', 'install-runtime', path.resolve('.'), '--platform', 'win32-x64', '--json'], env))
    assert.deepEqual(runtime, { directory: path.join(dataDir, 'models', 'sense-runtime'), platform: 'win32-x64', files: 33 })
    assert.ok(fs.existsSync(path.join(dataDir, 'models', 'sense-runtime', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64', 'onnxruntime.dll')))
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})
