import test from 'node:test'
import assert from 'node:assert/strict'
import {chromeCommands,chromeOptions,chromeShortcut,feedbackIssueBase,feedbackIssueURL,readerHistoryTarget,systemDescription} from '../src/chrome.mjs'

test('Windows keeps native caption buttons with a hidden title bar; other platforms retain their frame',()=>{
 const options=chromeOptions('win32')
 assert.equal(options.titleBarStyle,'hidden');assert.equal(options.titleBarOverlay.height,44)
 assert.equal(options.titleBarOverlay.color,'#171820')
 assert.deepEqual(chromeOptions('darwin'),{});assert.deepEqual(chromeOptions('linux'),{})
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
