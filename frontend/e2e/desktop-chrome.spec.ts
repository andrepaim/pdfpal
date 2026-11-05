import {test,expect} from '@playwright/test'
import {createProjectViaApi,mockAuth} from './helpers'

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
