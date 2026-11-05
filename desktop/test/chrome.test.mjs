import test from 'node:test'
import assert from 'node:assert/strict'
import {chromeOptions,chromeShortcut,readerHistoryTarget} from '../src/chrome.mjs'

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
