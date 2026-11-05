// Packaged Windows acceptance. Every mutation uses an isolated temporary library.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

if (process.platform !== 'win32') throw new Error('Use native Windows Node to test the packaged command.')
const application = path.resolve(process.argv[2]), receiptFile = process.argv[3] && path.resolve(process.argv[3])
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-acceptance-'))
const profile = path.join(root, 'profile'), library = path.join(root, 'library'), cli = path.join(path.dirname(application), 'bin', 'pdfpal.exe')
const checks = [], cleanEnv = { ...process.env }
for (const key of ['PDFPAL_DATA_DIR','PDFPAL_DB','PDFPAL_DESKTOP_PROFILE','ELECTRON_RUN_AS_NODE','PDFPAL_CLI_DESKTOP','PDFPAL_DESKTOP_BUILD']) delete cleanEnv[key]
// Keep the library service outside Windows' ephemeral client-port range.
let port
for(let attempt=0;attempt<50;attempt++){
  const probe=net.createServer(),candidate=18000+Math.floor(Math.random()*4000)
  try{
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(candidate,'127.0.0.1',resolve)})
    await new Promise(resolve=>probe.close(resolve));port=candidate;break
  }catch{}
}
assert.ok(port,'No isolated library service port was available')
const log = fs.openSync(path.join(root, 'app.log'), 'a')
const app = spawn(application, ['--hidden','--data-dir='+library,'--db='+path.join(library,'pdfpal.db'),'--profile='+profile,'--port='+port,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'], {env:cleanEnv,stdio:['ignore',log,log],windowsHide:true})
fs.closeSync(log)
const commandEnv = { ...cleanEnv, Path: path.join(process.env.SystemRoot, 'System32') }
delete commandEnv.PATH
const run = promisify(execFile)
let bootstrapped = false
async function command(args, options = {}) {
  try {
    const result = await run(cli, ['--desktop','--json','--profile',profile,...args], {env:commandEnv,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,...options})
    return JSON.parse(result.stdout)
  } catch (error) {
    if (bootstrapped && socket?.readyState===WebSocket.OPEN) {
      let health,identity
      try { const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(10000)});health=response.status;await response.json() }catch(error) {health={code:error.code??error.cause?.code??error.name}}
      try {const owner=JSON.parse(fs.readFileSync(path.join(library,'pdfpal.db.server.json'),'utf8'));const response=await fetch(owner.origin+'/api/runtime/identity',{headers:{'x-pdfpal-owner':owner.secret},signal:AbortSignal.timeout(10000)});identity=response.status;await response.json()}catch(error){identity={code:error.code??error.cause?.code??error.name}}
      console.error('Isolated CLI failure:',JSON.stringify({health,identity,appExited:app.exitCode,service:await evaluate('window.pdfpalDesktop.serviceState()').catch(()=>null)}))
    }
    throw error
  }
}
let socket, nextId = 0
const pending = new Map()
async function evaluate(expression, awaitPromise = true) {
  const id = ++nextId
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Renderer check timed out'))},15000)
    pending.set(id,{resolve:result=>{clearTimeout(timer);result.exceptionDetails?reject(new Error('Renderer check failed')):resolve(result.result?.value)},reject})
    socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise,returnByValue:true}}))
  })
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitForRenderer(expression, message) {
  for (let i=0;i<60;i++) {
    if (await evaluate(expression)) return
    await pause(100)
  }
  assert.fail(message)
}
async function connectRenderer(){
  let page
  for(let i=0;i<100;i++){
    try{
      const debugPort=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]
      const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json()
      page=pages.find(item=>item.type==='page')
      if(page)break
    }catch{}
    await pause(100)
  }
  assert.ok(page,'The isolated renderer did not start')
  socket=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){pending.get(message.id).resolve(message.result??{});pending.delete(message.id)}})
  // Keep visibility-aware refresh active in this isolated fixture when Windows
  // occludes its window, without taking focus from the user's application.
  const id=++nextId
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Renderer focus emulation timed out'))},10000)
    pending.set(id,{resolve:result=>{clearTimeout(timer);resolve(result)},reject})
    socket.send(JSON.stringify({id,method:'Emulation.setFocusEmulationEnabled',params:{enabled:true}}))
  })
}
try {
  await connectRenderer()
  let status
  for(let attempt=0;attempt<30;attempt++){
    try {status=await command(['status']);break}catch(error){
      if((await evaluate('window.pdfpalDesktop.serviceState()').catch(()=>null))?.state==='failed'){
        console.error('Isolated startup failure:',JSON.stringify(await evaluate('window.pdfpalDesktop.recovery()').catch(()=>null)))
        throw error
      }
    }
    if(app.exitCode!==null)throw new Error('The isolated app stopped during startup; inspect '+root)
    await pause(250)
  }
  assert.ok(status?.capabilities.includes('operation-receipts'))
  assert.equal(status.transport,'windows-pipe')
  bootstrapped = true
  checks.push('packaged-command-without-system-node','active-library-handshake','private-windows-pipe')
  for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector(".desktop-chrome")'))break;await pause(100)}
  const operation=randomUUID(),title='CLI ação 🧪 "quoted" & $() ` trailing\\'
  const scope=['--expect-library',status.library]
  const backupSettings=await fetch('http://127.0.0.1:'+port+'/api/recovery/settings',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({enabled:false,intervalHours:24,keep:7})})
  assert.equal(backupSettings.ok,true);await backupSettings.json()
  for(let i=0;i<40;i++)assert.equal((await command([...scope,'status'])).library,status.library)
  checks.push('forty-independent-cli-connections')
  const project=await command([...scope,'--operation',operation,'project','create',title])
  assert.equal(project.title,title)
  assert.equal((await command([...scope,'--operation',operation,'project','create',title])).id,project.id)
  assert.equal((await command([...scope,'project','list'])).total,1)
  checks.push('unicode-and-literal-argument-forwarding','idempotent-project-create')
  for(let i=0;i<60;i++){if(await evaluate('document.body.textContent.includes('+JSON.stringify(title)+')'))break;await pause(100)}
  assert.equal(await evaluate('document.body.textContent.includes('+JSON.stringify(title)+')'),true)
  checks.push('live-ui-refresh')
  await evaluate('history.pushState({},"",'+JSON.stringify('/projects/'+project.id)+');window.dispatchEvent(new PopStateEvent("popstate"));true')
  const newCollectionButton='Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("New Collection"))'
  await waitForRenderer('!!('+newCollectionButton+')','The project collection button did not appear')
  await evaluate(newCollectionButton+'.click();true')
  await waitForRenderer('!!document.querySelector(".collection-dialog[open]")','New Collection did not open an in-app dialog')
  async function submitCollection(name) {
    await evaluate('(()=>{const input=document.querySelector(".collection-dialog input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(name)+');input.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    await evaluate('document.querySelector(".collection-dialog form").requestSubmit();true')
    await waitForRenderer('!document.querySelector(".collection-dialog[open]")','The collection was not created')
  }
  await submitCollection('Native collection 🧪')
  const rootCollection=(await command([...scope,'collection','list',project.id])).items.find(collection=>collection.name==='Native collection 🧪')
  assert.ok(rootCollection)
  assert.equal(rootCollection.parent_id,null)
  await evaluate(`document.querySelector('button[title="New sub-collection"]').click();true`)
  await waitForRenderer('!!document.querySelector(".collection-dialog[open]")','New sub-collection did not open a dialog')
  await submitCollection('Native nested collection')
  const nestedCollection=(await command([...scope,'collection','list',project.id])).items.find(collection=>collection.name==='Native nested collection')
  assert.equal(nestedCollection?.parent_id,rootCollection.id)
  assert.equal(await evaluate('document.body.textContent.includes("Native nested collection")'),true)
  await evaluate(newCollectionButton+'.click();true')
  await waitForRenderer('!!document.querySelector(".collection-dialog[open]")','The collection dialog did not reopen')
  await evaluate('Array.from(document.querySelectorAll(".collection-dialog button")).find(button=>button.textContent==="Cancel").click();true')
  await waitForRenderer('!document.querySelector(".collection-dialog[open]")','Cancel did not close the collection dialog')
  assert.equal((await command([...scope,'collection','list',project.id])).total,2)
  checks.push('native-new-collection-dialog','native-nested-collection','native-collection-cancel')
  const pdf=path.join(root,'paper with spaces.pdf')
  const extract=path.join(root,'copy-fixture.mjs')
  fs.writeFileSync(extract,"import fs from 'node:fs';fs.copyFileSync("+JSON.stringify(path.join(path.dirname(application),'resources/app.asar/sample.pdf'))+","+JSON.stringify(pdf)+");")
  await run(application,[extract],{env:{...cleanEnv,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true})
  const source=await command([...scope,'source','add',project.id,pdf])
  assert.equal('pdf_text' in source,false)
  assert.equal((await command([...scope,'source','add',project.id,pdf])).id,source.id)
  assert.ok((await command([...scope,'search',project.id,'test'])).length)
  assert.equal((await command([...scope,'source','text',project.id,source.id,'--page','1','--limit','5'])).text.length,5)
  checks.push('native-pdf-import-and-deduplication','bounded-text-and-search')
  const markdown='\n# Olá 🧪\n\n  spaces  \n',file=path.join(root,'note.md')
  fs.writeFileSync(file,markdown)
  const note=await command([...scope,'note','create',project.id,'--content-file',file])
  assert.equal(note.content,markdown)
  const removed=await command([...scope,'--receipt','source','remove',project.id,source.id,'--yes'])
  await command([...scope,'trash','restore',removed.result.trashId])
  assert.equal((await command([...scope,'source','list',project.id])).total,1)
  const backup=await command([...scope,'backup','create'])
  assert.equal((await command([...scope,'backup','verify',backup.id])).valid,true)
  checks.push('utf8-note-file','undo-removal','verified-full-backup')
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  const ps="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & '"+cli.replaceAll("'","''")+"' --desktop --json --profile '"+profile.replaceAll("'","''")+"' project list; exit $LASTEXITCODE"
  const psResult=await run(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{env:commandEnv,encoding:'utf8',windowsHide:true})
  assert.equal(JSON.parse(psResult.stdout).items[0].title,title)
  const requestFile=path.join(root,'arguments.json')
  fs.writeFileSync(requestFile,JSON.stringify({args:['--desktop','--json','--profile',profile,...scope,'note','create',project.id,'--content','--standalone']}))
  const quotedRequest="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & '"+cli.replaceAll("'","''")+"' --request-file '"+requestFile.replaceAll("'","''")+"'; exit $LASTEXITCODE"
  const safeRequest=await run(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(quotedRequest,'utf16le').toString('base64')],{env:commandEnv,encoding:'utf8',windowsHide:true})
  assert.equal(JSON.parse(safeRequest.stdout).content,'--standalone')
  checks.push('powershell-json-argv')
  const cmdFile=path.join(root,'check.cmd')
  fs.writeFileSync(cmdFile,'@echo off\r\n"'+cli+'" --desktop --json --profile "'+profile+'" project list\r\nexit /b %errorlevel%\r\n')
  const cmdResult=await run(path.join(process.env.SystemRoot,'System32/cmd.exe'),['/d','/c',cmdFile],{env:commandEnv,encoding:'utf8',windowsHide:true})
  assert.equal(JSON.parse(cmdResult.stdout).total,1)
  checks.push('powershell-output','cmd-output')
  const adapterOption=process.argv.find(arg=>arg.startsWith('--wsl-adapter='))
  if(adapterOption){
    const adapter=adapterOption.slice('--wsl-adapter='.length),wsl=path.join(process.env.SystemRoot,'System32/wsl.exe')
    const prefix=['--distribution','Ubuntu-24.04','--exec','env','PDFPAL_WINDOWS_CLI='+cli,'python3',adapter,'--desktop','--json','--profile',profile,...scope]
    const listed=await run(wsl,[...prefix,'project','list'],{env:cleanEnv,encoding:'utf8',timeout:30000,windowsHide:true})
    assert.equal(JSON.parse(listed.stdout).items[0].title,title)
    const wslTitle='WSL ação "quotes" $() & ` \\',wslOp=randomUUID()
    const created=await run(wsl,[...prefix,'--operation',wslOp,'project','create',wslTitle],{env:cleanEnv,encoding:'utf8',timeout:30000,windowsHide:true})
    const wslProject=JSON.parse(created.stdout)
    assert.equal(wslProject.title,wslTitle)
    const request=run(wsl,[...prefix,'note','create',wslProject.id],{env:cleanEnv,encoding:'utf8',timeout:30000,windowsHide:true})
    request.child.stdin.end(markdown)
    assert.equal(JSON.parse((await request).stdout).content,markdown)
    checks.push('wsl-adapter-argument-roundtrip','wsl-utf8-stdin')
  }
  const installerTest=path.join(root,'skill-test.mjs'),skillHome=path.join(root,'skill-user')
  const moduleUrl=pathToFileURL(path.join(path.dirname(application),'resources/app.asar/dist/cli/skill-install.js')).href
  fs.writeFileSync(installerTest,"import assert from 'node:assert/strict';import {installSkill,uninstallSkill} from "+JSON.stringify(moduleUrl)+";const r=installSkill({home:"+JSON.stringify(skillHome)+"});assert.equal(r.installed,true);assert.equal(uninstallSkill("+JSON.stringify(skillHome)+").removed,true);")
  await run(application,[installerTest],{env:{...cleanEnv,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true})
  checks.push('skill-copy-from-asar','managed-skill-uninstall')
  const setup=await evaluate('window.pdfpalDesktop.cliSetup("check")')
  assert.equal(setup.available,true);assert.equal(setup.check.ok,true)
  await evaluate('window.dispatchEvent(new CustomEvent("pdfpal:open-panel",{detail:"cli"}));true')
  assert.equal(await evaluate('!!document.querySelector(".cli-settings[open]")'),true)
  const screenshotOption=process.argv.find(arg=>arg.startsWith('--screenshot='))
  if(screenshotOption){
    const id=++nextId
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Screenshot timed out'))},10000)
      pending.set(id,{resolve:result=>{clearTimeout(timer);fs.writeFileSync(screenshotOption.slice('--screenshot='.length),Buffer.from(result.data,'base64'));resolve()},reject})
      socket.send(JSON.stringify({id,method:'Page.captureScreenshot',params:{format:'png'}}))
    })
  }
  checks.push('native-setup-ipc-and-dialog')
  const receipt={format:1,status:'passed',version:status.build,cliProtocol:status.cliProtocol,schema:status.schema,checks,at:new Date().toISOString()}
  if(receiptFile)fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n')
  console.log(JSON.stringify(receipt))
} catch (error) {
  if (socket?.readyState===WebSocket.OPEN) {
    const renderer=await evaluate('({route:location.pathname,visibility:document.visibilityState,readyState:document.readyState,chrome:!!document.querySelector(".desktop-chrome"),dialogs:Array.from(document.querySelectorAll("dialog[open]")).map(dialog=>dialog.getAttribute("aria-label")||document.getElementById(dialog.getAttribute("aria-labelledby"))?.textContent)})').catch(()=>null)
    console.error('Isolated acceptance renderer:',JSON.stringify(renderer))
  }
  throw error
} finally {
  if(socket?.readyState===WebSocket.OPEN){await evaluate('window.pdfpalDesktop.quit()',false).catch(()=>{});socket.close()}
  for(let i=0;i<100&&app.exitCode===null;i++)await pause(100)
  if(app.exitCode===null)app.kill() // Only this driver's isolated child, never the user's installation.
}
