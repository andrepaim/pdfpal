import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {applicationMenuTemplate,bindMenu,chromeCommands,chromeOptions,chromeShortcut,desktopShell,desktopText,dockMenuTemplate,feedbackIssueBase,feedbackIssueURL,macShortcuts,readerHistoryTarget,shouldOfferApplicationsMove,systemDescription} from '../src/chrome.mjs'
import {protectedVault} from '../src/chatgpt/vault.mjs'
import {recoveryMessage} from '../src/setup.mjs'

test('Windows keeps native caption buttons with a hidden title bar; other platforms retain their frame',()=>{
 const options=chromeOptions('win32')
 assert.equal(options.titleBarStyle,'hidden');assert.equal(options.titleBarOverlay.height,44)
 assert.equal(options.titleBarOverlay.color,'#171820')
 assert.deepEqual(chromeOptions('linux'),{})
})
test('a Mac uses a hidden-inset title bar with the window buttons on the left of the in-window chrome',()=>{
 const options=chromeOptions('darwin')
 assert.equal(options.titleBarStyle,'hiddenInset');assert.equal(options.titleBarOverlay,undefined)
 // The buttons stay inside the 84 px left inset that desktop-chrome.css reserves, centred in the 44 px bar.
 assert.ok(options.trafficLightPosition.x>0&&options.trafficLightPosition.x<=20);assert.ok(options.trafficLightPosition.y>=12&&options.trafficLightPosition.y<=16)
})
test('the shell keeps the Windows tray and input shortcuts, and gives a Mac a Dock, an application menu and no tray',()=>{
 assert.deepEqual(desktopShell('win32'),{tray:true,dock:false,menu:'none',inputShortcuts:true,closeNotice:true,loginItems:true})
 assert.deepEqual(desktopShell('darwin'),{tray:false,dock:true,menu:'application',inputShortcuts:false,closeNotice:false,loginItems:true})
 assert.deepEqual(desktopShell('linux'),{tray:true,dock:false,menu:'default',inputShortcuts:false,closeNotice:true,loginItems:false})
})
test('reading-history navigation cannot return to recovery pages or leave the local reader',()=>{
 const origin='http://127.0.0.1:8200',entries=[{url:'file:///app/recovery.html'},{url:origin+'/'},{url:origin+'/projects/fixture'},{url:'https://example.com'}]
 assert.equal(readerHistoryTarget(entries,2,-1,origin),1)
 assert.equal(readerHistoryTarget(entries,1,-1,origin),undefined)
 assert.equal(readerHistoryTarget(entries,2,1,origin),undefined)
 assert.equal(readerHistoryTarget(entries,2,-1,undefined),undefined)
 assert.equal(readerHistoryTarget(entries,0,-1,origin),undefined)
})
test('desktop shortcuts preserve native Alt+F4, editing keys and AltGr combinations',()=>{
 const input=(key,extra={})=>({type:'keyDown',key,control:false,alt:false,meta:false,shift:false,...extra})
 for(const [key,command]of [['k','find'],[',','ai-settings'],['q','quit'],['+','zoom-in'],['-','zoom-out'],['0','zoom-reset']])assert.equal(chromeShortcut(input(key,{control:true})),command)
 assert.equal(chromeShortcut(input('F10')),'menu');assert.equal(chromeShortcut(input('F11')),'fullscreen')
 assert.equal(chromeShortcut(input('ArrowLeft',{alt:true})),'back')
 for(const event of [input('F4',{alt:true}),input('c',{control:true}),input('v',{control:true}),input('z',{control:true}),input('a',{control:true}),input('k',{control:true,alt:true}),input('k',{control:true,type:'keyUp'})])assert.equal(chromeShortcut(event),undefined)
})
test('Send feedback opens a GitHub issue that carries only the app and Windows versions',()=>{
 const url=new URL(feedbackIssueURL({version:'2.8.0-beta.1',platform:'win32',release:'10.0.22631'}))
 assert.equal(url.origin+url.pathname,feedbackIssueBase);assert.equal(url.protocol,'https:');assert.equal(url.username+url.password+url.hash,'')
 assert.deepEqual([...url.searchParams.keys()].sort(),['body','title'])
 assert.equal(url.searchParams.get('title'),'Feedback: ')
 const body=url.searchParams.get('body')
 assert.match(body,/^pdfpal version: 2\.8\.0-beta\.1$/m);assert.match(body,/^Operating system: Windows 11 \(10\.0\.22631\)$/m)
 assert.equal(feedbackIssueURL({version:'2.8.0-beta.1',platform:'win32',release:'10.0.22631'}),url.toString(),'the link depends only on its inputs')
 assert.equal(systemDescription('win32','10.0.19045'),'Windows 10 (10.0.19045)');assert.equal(systemDescription('linux','6.1.0'),'Linux 6.1.0')
})
test('feedback links refuse anything that is not a plain version token',()=>{
 for(const value of ['C:\\Users\\reader\\Thesis.pdf','/home/reader/thesis.pdf','reader@example.com','2.8.0 Secret project','http://127.0.0.1:8200/projects/abc','',undefined,{toString:()=>'x'},'1'.repeat(80)]){
  const body=new URL(feedbackIssueURL({version:value,platform:'win32',release:value})).searchParams.get('body')
  assert.match(body,/^pdfpal version: unknown$/m);assert.match(body,/^Operating system: Windows \(unknown\)$/m)
  if(typeof value==='string'&&value)assert.ok(!body.includes(value))
 }
})
test('the feedback window action takes no URL from the renderer',()=>{
 assert.ok(chromeCommands.includes('feedback'))
 for(const command of chromeCommands)assert.match(command,/^[a-z-]+$/)
 for(const value of [feedbackIssueURL({version:'2.8.0',platform:'win32',release:'10.0.22631'}),feedbackIssueBase,'https://example.com','feedback ',' feedback','FEEDBACK'])assert.ok(!chromeCommands.includes(value))
})

const actions=['ai-settings','updates','open-at-login','diagnostics','retry','licenses','quit','back','forward','zoom-in','zoom-out','zoom-reset','find','home','open-browser','feedback']
const handlers=Object.fromEntries(actions.map(action=>[action,()=>action]))
const flatten=items=>items.flatMap(item=>[item,...flatten(item.submenu??[])])
const input=(key,extra={})=>({type:'keyDown',key,control:false,alt:false,meta:false,shift:false,...extra})

test('Windows shortcuts are unchanged when the platform is explicit',()=>{
 for(const event of [input('k',{control:true}),input('F10'),input('F11'),input('ArrowLeft',{alt:true}),input('h',{control:true,shift:true}),input('=',{control:true}),input('c',{control:true})])assert.equal(chromeShortcut(event,'win32'),chromeShortcut(event))
})
test('a Mac never handles shortcuts in the input hook, so the menu accelerators are the single mechanism',()=>{
 for(const event of [input('k',{meta:true}),input('q',{meta:true}),input('k',{control:true}),input('F10'),input('F11'),input('ArrowLeft',{alt:true}),input('[',{meta:true}),input('0',{meta:true})])assert.equal(chromeShortcut(event,'darwin'),undefined)
})
test('Mac shortcuts use Command and Mac conventions, with no F10, F11 or Control-only keys',()=>{
 assert.deepEqual(macShortcuts,{'ai-settings':'Command+,',quit:'Command+Q',find:'Command+K',home:'Shift+Command+H',back:'Command+[',forward:'Command+]','zoom-in':'Command+=','zoom-out':'Command+-','zoom-reset':'Command+0'})
 const items=flatten(applicationMenuTemplate({ready:true,packaged:true}))
 const accelerators=items.filter(item=>item.accelerator).map(item=>item.accelerator)
 for(const accelerator of accelerators){assert.match(accelerator,/Command\+/);assert.doesNotMatch(accelerator,/F1[01]|Ctrl|CommandOrControl|Alt/)}
 assert.equal(new Set(accelerators).size,accelerators.length,'no accelerator is bound twice')
 for(const [action,accelerator]of Object.entries(macShortcuts))assert.equal(items.find(item=>item.id===action).accelerator,accelerator)
 assert.equal(items.find(item=>item.id==='zoom-in-plus').action,'zoom-in')
 // Full screen uses the standard role (Control-Command-F and the system label).
 assert.ok(items.some(item=>item.role==='togglefullscreen'))
})
test('the Mac application menu has the standard Edit roles, the tray actions and no developer items when packaged',()=>{
 const template=applicationMenuTemplate({name:'pdfpal',ready:true,booting:false,openAtLogin:true,packaged:true})
 assert.deepEqual(template.map(menu=>menu.label),['pdfpal','Edit','View','Go','Window','Help'])
 const items=flatten(template),roles=items.map(item=>item.role).filter(Boolean)
 for(const role of ['about','undo','redo','cut','copy','paste','selectAll','hide','hideOthers','unhide','minimize','zoom','front','togglefullscreen'])assert.ok(roles.includes(role),role)
 for(const role of ['reload','forceReload','toggleDevTools'])assert.ok(!roles.includes(role),role)
 assert.equal(template[4].role,'window');assert.equal(template[5].role,'help')
 for(const item of items.filter(item=>item.action))assert.ok(actions.includes(item.action),item.action)
 // Window actions reuse the renderer-validated chromeCommand list; the rest are the existing tray actions.
 for(const action of ['back','forward','zoom-in','zoom-out','zoom-reset','find','home','open-browser','feedback'])assert.ok(chromeCommands.includes(action))
 const byId=id=>items.find(item=>item.id===id)
 assert.equal(byId('quit').accelerator,'Command+Q');assert.equal(byId('quit').label,'Quit pdfpal')
 assert.deepEqual([byId('open-at-login').type,byId('open-at-login').checked,byId('open-at-login').label],['checkbox',true,'Open at Login'])
 assert.equal(byId('ai-settings').enabled,true);assert.equal(byId('retry').visible,false)
 for(const id of ['feedback','diagnostics','open-browser','licenses','updates'])assert.ok(byId(id),id)
 const development=flatten(applicationMenuTemplate({ready:true,packaged:false})).map(item=>item.role)
 assert.ok(development.includes('reload')&&development.includes('toggleDevTools'))
})
test('the Mac menus follow the service state as the tray does',()=>{
 const starting=flatten(applicationMenuTemplate({ready:false,booting:true,openAtLogin:true}))
 const failed=flatten(applicationMenuTemplate({ready:false,booting:false}))
 const byId=(items,id)=>items.find(item=>item.id===id)
 assert.equal(byId(starting,'ai-settings').enabled,false);assert.equal(byId(starting,'open-at-login').checked,false);assert.equal(byId(starting,'retry').visible,false)
 assert.equal(byId(failed,'retry').visible,true);assert.equal(byId(failed,'open-browser').enabled,false)
 assert.deepEqual(dockMenuTemplate({ready:true}).map(item=>[item.label,item.action,item.enabled]),[['Open in Browser','open-browser',true],['Retry Service','retry',false]])
 assert.deepEqual(dockMenuTemplate({ready:false,booting:false}).map(item=>item.enabled),[false,true])
 assert.deepEqual(dockMenuTemplate({ready:false,booting:true}).map(item=>item.enabled),[false,false])
})
test('menu binding replaces action names with handlers and refuses unknown actions',()=>{
 const bound=flatten(bindMenu(applicationMenuTemplate({ready:true}),handlers))
 for(const item of bound){assert.equal(item.action,undefined);if(actions.includes(item.id))assert.equal(item.click({}),item.id)}
 assert.equal(bound.find(item=>item.id==='zoom-in-plus').click({}),'zoom-in')
 assert.equal(bindMenu(dockMenuTemplate({ready:true}),handlers)[0].click(),'open-browser')
 let received;bindMenu([{label:'x',action:'open-at-login'}],{'open-at-login':item=>{received=item}})[0].click({checked:true})
 assert.deepEqual(received,{checked:true})
 assert.throws(()=>bindMenu([{label:'x',action:'toString'}],{}),/No handler/)
 assert.throws(()=>bindMenu([{label:'x',submenu:[{label:'y',action:'missing'}]}],handlers),/No handler/)
})
test('the Applications folder offer is Mac-only, packaged-only, never automated and respects "do not ask again"',()=>{
 let asked=0;const outside=()=>{asked++;return false},inside=()=>{asked++;return true}
 assert.equal(shouldOfferApplicationsMove({platform:'darwin',packaged:true,automated:false,declined:false,inApplications:outside}),true)
 assert.equal(shouldOfferApplicationsMove({platform:'darwin',packaged:true,automated:false,declined:false,inApplications:inside}),false)
 assert.equal(asked,2)
 for(const options of [{platform:'win32',packaged:true},{platform:'darwin',packaged:false},{platform:'darwin',packaged:true,automated:true},{platform:'darwin',packaged:true,declined:true}])
  assert.equal(shouldOfferApplicationsMove({automated:false,declined:false,...options,inApplications:outside}),false)
 assert.equal(asked,2,'the Mac-only Electron check runs only when a prompt is otherwise allowed')
})
test('no user-visible string on a Mac says Windows or points at a tray',async()=>{
 const strings=[]
 const collect=value=>{if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')for(const item of Object.values(value))collect(item)}
 collect(desktopText('darwin'))
 for(const state of [{ready:true},{ready:false,booting:false},{ready:false,booting:true}]){
  collect(flatten(applicationMenuTemplate(state)).map(item=>item.label));collect(dockMenuTemplate(state).map(item=>item.label))
 }
 for(const code of ['EADDRINUSE','EACCES','NEWER_DATABASE','STARTING','BACKEND_FAILED'])collect(recoveryMessage(code))
 await protectedVault('/nonexistent',{isAsyncEncryptionAvailable:async()=>false},'darwin').write({}).catch(error=>strings.push(error.message))
 // The recovery page chooses its own Mac sentence from the bridge's platform.
 const recovery=fs.readFileSync(new URL('../src/recovery.js',import.meta.url),'utf8')
 const recoveryMac=[...recovery.matchAll(/platform === 'darwin' \? '([^']+)'/g)].map(match=>match[1])
 assert.equal(recoveryMac.length,1);strings.push(...recoveryMac)
 assert.ok(strings.length>40)
 for(const value of strings){assert.doesNotMatch(value,/Windows/,value);assert.doesNotMatch(value,/\btray\b/i,value)}
 assert.match(desktopText('darwin').chatgptLocked,/Keychain/)
 // Windows keeps its existing text.
 assert.equal(desktopText('win32').chatgptLocked,'Windows could not unlock the saved connection. Reconnect in AI settings.')
 assert.equal(desktopText('win32').cliCheckFailed,'The bundled CLI could not be checked. Repair the Windows installation.')
 assert.deepEqual([desktopText('win32').closeNoticeTitle,desktopText('win32').closeNoticeBody],['pdfpal is still running','Reopen pdfpal from the tray. Choose Quit there to stop it.'])
})
