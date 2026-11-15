import {test,expect,type Page} from '@playwright/test'
import {createProjectViaApi,mockAuth} from './helpers'
import {fileURLToPath} from 'node:url'
import type {DesktopChromeState} from '../src/desktop'
import {feedbackIssueURL} from '../../desktop/src/chrome.mjs'

type BridgeMode='legacy'|'linux'|'windows'|'disabled'|'absent'
async function desktopBridge(page:Page,mode:BridgeMode='legacy'){
 await page.addInitScript(mode=>{
  if(mode==='absent'){delete window.pdfpalDesktop;return}
  let listener:((command:string)=>void)|undefined,diagnosticsListener:(()=>void)|undefined,stateListener:((state:DesktopChromeState)=>void)|undefined
  const state={version:'2.6.0-preview.1',focused:true,maximized:false,fullscreen:false,canGoBack:mode==='linux',canGoForward:mode==='linux',zoom:1,...(mode==='linux'?{startAtLogin:false}:{})}
  const record=(command:string)=>{const calls=JSON.parse(localStorage.getItem('chrome-commands')||'[]');calls.push(command);localStorage.setItem('chrome-commands',JSON.stringify(calls));localStorage.setItem('chrome-command',command)}
  window.pdfpalDesktop={chrome:mode!=='linux',...(mode==='legacy'?{}:{capabilities:{sharedMenu:mode!=='disabled',titleBarOverlay:mode==='windows'}}),platform:mode==='linux'?'linux':'win32',setAgent:async id=>id,onAgentChanged:()=>()=>{},setupStatus:async()=>({complete:true}),chromeState:async()=>state,chromeCommand:async(...args:[string,...unknown[]])=>{const [command]=args;record(command);localStorage.setItem('chrome-command-args',JSON.stringify(args));if(command==='diagnostics')diagnosticsListener?.();if(command==='startup-toggle'){state.startAtLogin=!state.startAtLogin;stateListener?.({...state})}return true},onChromeState:callback=>{stateListener=callback;return()=>{stateListener=undefined}},onChromeCommand:callback=>{listener=callback;return()=>{listener=undefined}},checkUpdates:async()=>({state:'unpublished',currentVersion:state.version,distribution:'unsigned'}),onOpenUpdates:()=>()=>{},onOpenDiagnostics:callback=>{diagnosticsListener=callback;return()=>{diagnosticsListener=undefined}},diagnostics:async()=>({app:{version:state.version},events:[]}),exportDiagnostics:async()=>{record('export-diagnostics');return true}}
  window.addEventListener('native-chrome-test',event=>listener?.((event as CustomEvent).detail))
 },mode)
}

test.beforeEach(async({page})=>{await mockAuth(page)})

test.describe('legacy Windows desktop bridge',()=>{
 test.beforeEach(async({page})=>{await desktopBridge(page)})

test('the compact menu opens settings and supports keyboard navigation instead of the old menu strip',async({page})=>{
 await page.goto('/')
 await expect(page.getByRole('banner',{name:'pdfpal window toolbar'})).toBeVisible()
 await expect(page.locator('.projects-page-header')).not.toBeVisible()
 await page.getByRole('button',{name:'pdfpal menu',exact:true}).click()
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 await expect(menu.getByRole('menuitem',{name:'All projects'})).toBeFocused()
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
 await expect(page.getByRole('dialog',{name:'YOUR PROJECTS'})).toBeVisible()
 await page.keyboard.press('Escape')
 await expect(page.getByRole('button',{name:'Find a project',exact:true})).toBeFocused()
 await page.getByRole('button',{name:'pdfpal menu',exact:true}).click()
 await menu.getByRole('menuitem',{name:'Backups & recovery'}).click()
 await expect(page.getByRole('dialog',{name:'Backups & recovery'})).toBeVisible()
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Cloud library',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Your cloud library'})).toBeVisible()
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Help and updates'}).click()
 await expect(page.getByRole('dialog',{name:'Software updates'})).toBeVisible()
})
test('project finder opens from the native shortcut, filters and navigates with Enter',async({page})=>{
 const project=await createProjectViaApi(page,'Chrome project '+Date.now())
 await page.goto('/')
 await expect(page.getByRole('button',{name:'Find a project',exact:true})).toBeVisible()
 await page.keyboard.press('Control+k')
 const input=page.getByRole('combobox',{name:'Search projects'})
 await expect(input).toBeFocused();await input.fill(project.title)
 await expect(page.getByRole('option',{name:new RegExp(project.title)})).toBeVisible()
 await input.press('Enter')
 await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
 await expect(page.getByRole('button',{name:'Find a project',exact:true})).toContainText(project.title)
 const header=page.getByRole('banner',{name:'pdfpal window toolbar'}),box=(await header.boundingBox())!
 expect(box.height).toBe(44)
 expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(await page.evaluate(()=>innerHeight))
})
test('window actions stay in the native bridge and the menu fits the minimum window',async({page},info)=>{
 await page.setViewportSize({width:600,height:400});await page.goto('/')
 const button=page.getByRole('button',{name:'pdfpal menu',exact:true});await button.click()
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 const box=(await menu.boundingBox())!;expect(box.y+box.height).toBeLessThanOrEqual(400)
 await menu.getByRole('menuitem',{name:'Zoom in'}).click()
 expect(await page.evaluate(()=>localStorage.getItem('chrome-command'))).toBe('zoom-in')
 await button.click();await page.keyboard.press('Escape');await expect(button).toBeFocused()
 await page.screenshot({path:info.outputPath('desktop-chrome-small.png')})
})
test('Send feedback asks the native bridge for a GitHub issue that carries only the app and Windows versions',async({page})=>{
 await page.addInitScript(()=>{window.pdfpalDesktop!.chromeCommand=async(...args:unknown[])=>{localStorage.setItem('chrome-command-args',JSON.stringify(args));return true}})
 const project=await createProjectViaApi(page,'Private thesis project '+Date.now())
 const file=fileURLToPath(new URL('../../test/fixtures/sample.pdf',import.meta.url))
 const created=await page.request.post(`/api/projects/${project.id}/sources`,{data:{url:file,title:'Confidential chapter draft'}})
 expect(created.ok()).toBeTruthy()
 const source=await created.json()
 await page.goto(`/projects/${project.id}/sources/${source.id}`)
 await expect(page.getByRole('button',{name:'Find a project',exact:true})).toContainText(project.title)
 await page.keyboard.press('F10')
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 await expect(menu).toContainText('pdfpal 2.6.0-preview.1')
 await menu.getByRole('menuitem',{name:'Send feedback'}).click()
 await expect(menu).toBeHidden()
 const private_=[project.title,project.id,source.id,source.title,file,'sample.pdf',page.url(),'test@example.com','Test User']
 // The renderer sends only the fixed command name; the main process builds the link from its own version data.
 const sent=await page.evaluate(()=>localStorage.getItem('chrome-command-args'))
 expect(JSON.parse(sent!)).toEqual(['feedback'])
 // This is the builder the desktop main process uses with app.getVersion() and the Windows version.
 const url=new URL(feedbackIssueURL({version:'2.6.0-preview.1',platform:'win32',release:'10.0.22631'}))
 expect(url.origin+url.pathname).toBe('https://github.com/andrepaim/pdfpal/issues/new')
 expect([...url.searchParams.keys()].sort()).toEqual(['body','title'])
 const body=url.searchParams.get('body')!
 expect(body).toContain('pdfpal version: 2.6.0-preview.1')
 expect(body).toContain('Operating system: Windows 11 (10.0.22631)')
 for(const value of private_){expect(body).not.toContain(value);expect(decodeURIComponent(url.href)).not.toContain(value)}
})

})


test.describe('Linux native-frame desktop bridge',()=>{
 test.beforeEach(async({page})=>{await desktopBridge(page,'linux')})

 test('the toolbar fills the native frame at normal and minimum widths',async({page},info)=>{
  await page.goto('/')
  const toolbar=page.getByRole('banner',{name:'pdfpal window toolbar'})
  await expect(toolbar).toBeVisible()
  await expect(page.locator('.projects-page-header')).not.toBeVisible()
  for(const [width,height] of [[1280,800],[600,400]]){
   await page.setViewportSize({width,height})
   const box=(await toolbar.boundingBox())!,inner=(await page.locator('.desktop-chrome-inner').boundingBox())!
   expect(box.height).toBe(44);expect(box.x).toBe(0);expect(box.width).toBe(width)
   expect(inner.x).toBe(0);expect(inner.width).toBe(width)
   expect(await toolbar.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).not.toBe('drag')
   expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(height)
   await page.screenshot({path:info.outputPath(`linux-toolbar-${width}.png`)})
   await page.getByRole('button',{name:'pdfpal menu',exact:true}).click()
   const menu=page.getByRole('menu',{name:'pdfpal menu'}),menuBox=(await menu.boundingBox())!
   expect(menuBox.x+menuBox.width).toBeLessThanOrEqual(width);expect(menuBox.y+menuBox.height).toBeLessThanOrEqual(height)
   await page.screenshot({path:info.outputPath(`linux-menu-${width}.png`)})
   await page.keyboard.press('Escape')
  }
 })

 test('F10, arrow navigation and dismissal preserve menu focus and dialog shortcuts',async({page})=>{
  await page.goto('/')
  const trigger=page.getByRole('button',{name:'pdfpal menu',exact:true}),menu=page.getByRole('menu',{name:'pdfpal menu'})
  await expect(trigger).toBeVisible()
  await page.keyboard.press('F10')
  const first=menu.getByRole('menuitem',{name:'All projects'}),last=menu.getByRole('menuitem',{name:'Quit pdfpal'})
  await expect(first).toBeFocused()
  await page.keyboard.press('ArrowUp');await expect(last).toBeFocused()
  await page.keyboard.press('ArrowDown');await expect(first).toBeFocused()
  await page.keyboard.press('End');await expect(last).toBeFocused()
  await page.keyboard.press('Home');await expect(first).toBeFocused()
  await page.keyboard.press('ArrowDown');await expect(menu.getByRole('menuitem',{name:'Find a project…'})).toBeFocused()
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused()
  await page.keyboard.press('F10');await expect(menu).toBeVisible()
  await page.keyboard.press('F10');await expect(menu).toBeHidden();await expect(trigger).toBeFocused()
  await trigger.click();await page.mouse.click(580,350);await expect(menu).toBeHidden()
  await trigger.click();await menu.getByRole('menuitem',{name:'Backups & recovery'}).click()
  const dialog=page.getByRole('dialog',{name:'Backups & recovery'})
  await expect(dialog).toBeVisible()
  await page.keyboard.press('F10');await page.keyboard.press('Control+k')
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('native-chrome-test',{detail:'menu'}));window.dispatchEvent(new CustomEvent('native-chrome-test',{detail:'find'}))})
  await expect(dialog).toBeVisible();await expect(menu).toBeHidden();await expect(page.getByRole('combobox',{name:'Search projects'})).toBeHidden()
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden()
 })

 test('Ctrl+K filters projects and Enter navigates within the shared reader',async({page})=>{
  const project=await createProjectViaApi(page,'Linux reading project '+Date.now())
  await page.goto('/')
  await expect(page.getByRole('banner',{name:'pdfpal window toolbar'})).toBeVisible()
  await page.keyboard.press('Control+k')
  const input=page.getByRole('combobox',{name:'Search projects'})
  await expect(input).toBeFocused();await input.fill(project.title)
  await expect(page.getByRole('option',{name:new RegExp(project.title)})).toBeVisible()
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
  await expect(page.getByRole('button',{name:'Find a project',exact:true})).toContainText(project.title)
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('native-chrome-test',{detail:'home'})))
  await expect(page).toHaveURL('/')
 })

 test('history and remaining native actions use fixed bridge commands',async({page})=>{
  await page.goto('/')
  const trigger=page.getByRole('button',{name:'pdfpal menu',exact:true}),menu=page.getByRole('menu',{name:'pdfpal menu'})
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await page.getByRole('button',{name:'Go forward',exact:true}).click()
  const commands=['back','forward']
  for(const [label,command] of [['Zoom in','zoom-in'],['Zoom out','zoom-out'],['Actual size','zoom-reset'],['Full screen','fullscreen'],['Third-party licenses','licenses'],['Open in browser','open-browser'],['Quit pdfpal','quit']]){
   await trigger.click();await menu.getByRole('menuitem',{name:label,exact:!['Zoom in','Zoom out','Actual size','Full screen','Quit pdfpal'].includes(label)}).click()
   await expect(menu).toBeHidden();commands.push(command)
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chrome-command-args')!))).toEqual([command])
  }
  await trigger.click()
  await expect(menu.getByRole('menuitemcheckbox',{name:'Start at login'})).toHaveAttribute('aria-checked','false')
  await menu.getByRole('menuitemcheckbox',{name:'Start at login'}).click();commands.push('startup-toggle')
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chrome-command-args')!))).toEqual(['startup-toggle'])
  await trigger.click();await expect(menu.getByRole('menuitemcheckbox',{name:'Start at login'})).toHaveAttribute('aria-checked','true')
  await menu.getByRole('menuitem',{name:/^Diagnostics/}).click();commands.push('diagnostics')
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chrome-command-args')!))).toEqual(['diagnostics'])
  const dialog=page.getByRole('dialog',{name:'Diagnostic preview'})
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('2.6.0-preview.1')
  await dialog.getByRole('button',{name:'Export report'}).click();commands.push('export-diagnostics')
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chrome-commands')||'[]'))).toEqual(commands)
 })
})

for(const mode of ['legacy','windows'] as const){
 test(`${mode} Windows bridge preserves native caption space`,async({page})=>{
  await desktopBridge(page,mode);await page.goto('/')
  const toolbar=page.getByRole('banner',{name:'pdfpal window toolbar'})
  await expect(toolbar).toBeVisible()
  const box=(await toolbar.boundingBox())!,inner=(await page.locator('.desktop-chrome-inner').boundingBox())!
  expect(inner.width).toBe(box.width-138)
  expect(await toolbar.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag')
  await page.keyboard.press('F10')
  await expect(page.getByRole('menuitemcheckbox',{name:'Start at login'})).toHaveCount(0)
 })
}

for(const mode of ['absent','disabled'] as const){
 test(`${mode} desktop capability preserves browser layout and keyboard handling`,async({page})=>{
  await desktopBridge(page,mode);await page.goto('/')
  await expect(page.locator('.projects-page-header')).toBeVisible()
  await expect(page.getByRole('banner',{name:'pdfpal window toolbar'})).toHaveCount(0)
  expect(await page.locator('html').evaluate(el=>el.classList.contains('desktop-shell'))).toBe(false)
  expect((await page.locator('.projects-page-header').boundingBox())!.y).toBe(0)
  await page.keyboard.press('F10');await page.keyboard.press('Control+k')
  await expect(page.getByRole('menu',{name:'pdfpal menu'})).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'Search projects'})).toHaveCount(0)
 })
}
