import {test,expect} from '@playwright/test'
import {createProjectViaApi,mockAuth} from './helpers'
import {fileURLToPath} from 'node:url'
import {feedbackIssueURL} from '../../desktop/src/chrome.mjs'

test.beforeEach(async({page})=>{
 await mockAuth(page)
 await page.addInitScript(()=>{
  let listener:((command:string)=>void)|undefined
  const state={version:'2.6.0-preview.1',focused:true,maximized:false,fullscreen:false,canGoBack:false,canGoForward:false,zoom:1}
  window.pdfpalDesktop={chrome:true,setAgent:async id=>id,onAgentChanged:()=>()=>{},setupStatus:async()=>({complete:true}),chromeState:async()=>state,chromeCommand:async command=>{localStorage.setItem('chrome-command',command);return true},onChromeCommand:callback=>{listener=callback;return()=>{listener=undefined}},checkUpdates:async()=>({state:'unpublished',currentVersion:state.version,distribution:'unsigned'}),onOpenUpdates:()=>()=>{}}
  window.addEventListener('native-chrome-test',event=>listener?.((event as CustomEvent).detail))
 })
})

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
