import {test,expect,type Page} from '@playwright/test'
import {mockAuth} from './helpers'

/** Fake the desktop bridge as the Mac (or Windows) app's preload would expose it. */
async function fakeBridge(page:Page,platform:'darwin'|'win32'){
 await mockAuth(page)
 await page.addInitScript(platform=>{
  let command:((command:string)=>void)|undefined,stateListener:((state:any)=>void)|undefined,diagnostics:(()=>void)|undefined,cancel:(()=>void)|undefined
  const state={version:'2.9.0-preview.1',focused:true,maximized:false,fullscreen:false,canGoBack:false,canGoForward:false,zoom:1}
  const agents=[{id:'claude',label:'Claude',available:false,state:'missing',auth:'unknown'},{id:'codex',label:'Codex',available:true,state:'installed',auth:'account',version:'0.164.0'}]
  window.pdfpalDesktop={chrome:true,platform,setAgent:async id=>id,onAgentChanged:()=>()=>{},setupStatus:async()=>({complete:true}),
   setupState:async()=>({default:'codex',complete:true,agents}),setupAction:async()=>{},
   testConnection:()=>new Promise((_resolve,reject)=>{cancel=()=>reject(new Error('Connection test cancelled.'))}),
   cancelTest:async()=>{cancel?.();throw new Error('stopped')},
   chromeState:async()=>state,chromeCommand:async value=>{localStorage.setItem('chrome-command',value);return true},
   onChromeState:callback=>{stateListener=callback;return()=>{stateListener=undefined}},
   onChromeCommand:callback=>{command=callback;return()=>{command=undefined}},
   checkUpdates:async()=>({state:'available',currentVersion:state.version,version:'2.9.0',publisher:'pdfpal',distribution:'unsigned'}),onOpenUpdates:()=>()=>{},
   serviceState:async()=>({state:'ready'}),onServiceState:()=>()=>{},
   diagnostics:async()=>{throw new Error('stopped')},onOpenDiagnostics:callback=>{diagnostics=callback;return()=>{diagnostics=undefined}},
   cliSetup:async action=>{
    const link=localStorage.getItem('link-state')??'missing'
    return {available:localStorage.getItem('cli-available')!=='false',launcher:'/Applications/pdfpal.app/Contents/Resources/bin/pdfpal',version:state.version,library:'Fixture library',
     setupCommand:"'/Applications/pdfpal.app/Contents/Resources/bin/pdfpal' --desktop skill install",skill:{installed:action==='install',managed:true,edited:false,directory:'fixture',legacy:[]},
     link:{path:'/Users/reader/.local/bin/pdfpal',state:action==='install'&&link==='missing'?'installed':link}}
   }}
  window.addEventListener('test-chrome-command',event=>command?.((event as CustomEvent).detail))
  window.addEventListener('test-chrome-state',event=>stateListener?.({...state,...(event as CustomEvent).detail}))
  window.addEventListener('test-diagnostics',()=>diagnostics?.())
 },platform)
}
/** Everything a reader can see now: rendered text plus tooltips and accessible names. */
const visibleText=(page:Page)=>page.evaluate(()=>[document.body.innerText,...Array.from(document.querySelectorAll('[title],[aria-label]')).flatMap(node=>[node.getAttribute('title')??'',node.getAttribute('aria-label')??''])].join('\n'))

test('the Mac title bar leaves room for the window buttons on the left, reserves nothing on the right and stays draggable',async({page})=>{
 await fakeBridge(page,'darwin');await page.setViewportSize({width:1000,height:700});await page.goto('/')
 const header=page.getByRole('banner',{name:'pdfpal window toolbar'})
 await expect(header).toBeVisible()
 expect(await page.evaluate(()=>[...document.documentElement.classList])).toEqual(expect.arrayContaining(['desktop-shell','desktop-mac']))
 const layout=()=>page.evaluate(()=>{const bar=document.querySelector('.desktop-chrome')!,inner=document.querySelector('.desktop-chrome-inner')!;const style=getComputedStyle(inner)
  return {height:bar.getBoundingClientRect().height,drag:getComputedStyle(bar).getPropertyValue('-webkit-app-region'),width:inner.getBoundingClientRect().width,left:style.paddingLeft,menu:document.querySelector('[aria-label="pdfpal menu"]')!.getBoundingClientRect().left}})
 const normal=await layout()
 expect(normal).toMatchObject({height:44,drag:'drag',width:1000,left:'84px'})
 expect(normal.menu).toBeGreaterThanOrEqual(84)
 const tools=(await page.getByRole('button',{name:'Help and updates'}).boundingBox())!
 expect(tools.x+tools.width).toBeGreaterThan(1000-40)
 // macOS hides the window buttons in full screen, so the inset goes away.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('test-chrome-state',{detail:{fullscreen:true}})))
 await expect(header).toHaveClass(/is-fullscreen/)
 expect((await layout()).left).toBe('10px')
 await page.screenshot({path:test.info().outputPath('desktop-mac-titlebar.png')})
})
test('Windows keeps its title bar layout: no Mac class and the caption-button space on the right',async({page})=>{
 await fakeBridge(page,'win32');await page.setViewportSize({width:1000,height:700});await page.goto('/')
 await expect(page.getByRole('banner',{name:'pdfpal window toolbar'})).toBeVisible()
 const result=await page.evaluate(()=>({classes:[...document.documentElement.classList],width:document.querySelector('.desktop-chrome-inner')!.getBoundingClientRect().width,left:getComputedStyle(document.querySelector('.desktop-chrome-inner')!).paddingLeft}))
 expect(result.classes).toContain('desktop-shell');expect(result.classes).not.toContain('desktop-mac')
 expect(result).toMatchObject({width:1000-138,left:'10px'})
 await page.getByRole('button',{name:'pdfpal menu',exact:true}).click()
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 await expect(menu.getByRole('menuitem',{name:'Full screen'})).toContainText('F11')
 await expect(menu.getByRole('menuitem',{name:'Find a project…'})).toContainText('Ctrl K')
 await expect(page.getByRole('button',{name:'Go back'})).toHaveAttribute('title','Back (Alt+Left)')
})
test('Mac shortcut hints show Command keys and the menu bar, not the page, handles the shortcuts',async({page})=>{
 await fakeBridge(page,'darwin');await page.goto('/')
 await expect(page.getByRole('button',{name:'pdfpal menu',exact:true})).toHaveAttribute('title','pdfpal menu')
 await expect(page.getByRole('button',{name:'Go back'})).toHaveAttribute('title','Back (⌘[)')
 await expect(page.getByRole('button',{name:'Go forward'})).toHaveAttribute('title','Forward (⌘])')
 await expect(page.getByRole('button',{name:'Find a project',exact:true})).toHaveAttribute('title','Find a project (⌘K)')
 // Control-K and F10 are ordinary keys on a Mac; Command-K reaches the page only through the menu accelerator.
 await page.keyboard.press('Control+k');await page.keyboard.press('F10')
 await expect(page.getByRole('dialog',{name:'YOUR PROJECTS'})).not.toBeVisible()
 await expect(page.getByRole('menu',{name:'pdfpal menu'})).not.toBeVisible()
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('test-chrome-command',{detail:'find'})))
 await expect(page.getByRole('dialog',{name:'YOUR PROJECTS'})).toBeVisible()
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'pdfpal menu',exact:true}).click()
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 for(const [name,key]of [['All projects','⇧⌘H'],['Find a project…','⌘K'],['AI settings','⌘,'],['Zoom in','⌘+'],['Zoom out','⌘−'],['Actual size','⌘0'],['Full screen','⌃⌘F'],['Quit pdfpal','⌘Q']])
  await expect(menu.getByRole('menuitem',{name})).toContainText(key)
})
test('a Mac reader never sees Windows, tray or Windows key wording in the desktop dialogs',async({page})=>{
 await fakeBridge(page,'darwin');await page.goto('/')
 const seen:string[]=[]
 const collect=async()=>{seen.push(await visibleText(page))}
 const menu=page.getByRole('menu',{name:'pdfpal menu'})
 const open=async(name:string)=>{await page.getByRole('button',{name:'pdfpal menu',exact:true}).click();await menu.getByRole('menuitem',{name}).click()}
 await expect(page.getByRole('banner',{name:'pdfpal window toolbar'})).toBeVisible()
 await page.getByRole('button',{name:'pdfpal menu',exact:true}).click();await expect(menu).toBeVisible();await collect();await page.keyboard.press('Escape')

 // AI settings: installation and sign-in open the official guide on a Mac; a failed cancel names the Help menu.
 await open('AI settings')
 const settings=page.getByRole('dialog',{name:'AI assistant'})
 await settings.getByRole('button',{name:'Install Claude Code'}).click()
 await expect(settings.getByRole('region',{name:'Confirm assistant setup'})).toContainText('official setup guide in your browser');await collect()
 await settings.getByRole('button',{name:'Open setup guide'}).click()
 await expect(settings.getByRole('status')).toContainText('opened in your browser');await collect()
 await settings.getByRole('button',{name:'Sign in again'}).click()
 await expect(settings.getByRole('region',{name:'Confirm assistant setup'})).toContainText('sign-in steps');await collect()
 await settings.getByRole('button',{name:'Back'}).click()
 await settings.getByRole('button',{name:'Test connection'}).click()
 await settings.getByRole('button',{name:'Cancel test'}).click()
 await expect(settings.getByRole('alert')).toContainText('Help menu');await collect()
 await settings.getByRole('button',{name:'Close AI settings'}).click()

 // Command line: Mac heading, Dock wording, the ~/.local/bin link and PATH instructions, and a reported conflict.
 await open('Command line & ChatGPT')
 const cli=page.getByRole('dialog',{name:'Command line & ChatGPT'})
 await expect(cli.getByRole('heading',{name:'Terminal command'})).toBeVisible()
 await expect(cli).toContainText('~/.local/bin');await expect(cli).toContainText('export PATH="$HOME/.local/bin:$PATH"');await collect()
 await cli.getByRole('button',{name:'Install command and skill'}).click()
 await expect(cli.getByRole('status')).toContainText('Command and skill installed')
 await expect(cli).toContainText('Command link: /Users/reader/.local/bin/pdfpal');await collect()
 await page.keyboard.press('Escape')
 await page.evaluate(()=>{localStorage.setItem('link-state','conflict');localStorage.setItem('cli-available','false')})
 await open('Command line & ChatGPT')
 await expect(cli).toContainText('Another file already exists at /Users/reader/.local/bin/pdfpal. pdfpal did not replace it.')
 await expect(cli).toContainText('Reinstall pdfpal from its disk image');await collect()
 await page.keyboard.press('Escape')

 // Software updates and diagnostics.
 await open('Software updates')
 const updates=page.getByRole('dialog',{name:'Software updates'})
 await expect(updates).toContainText('replace the app in your Applications folder');await collect()
 await page.keyboard.press('Escape')
 await page.evaluate(()=>window.dispatchEvent(new Event('test-diagnostics')))
 await expect(page.getByRole('alert').filter({hasText:'diagnostics'})).toContainText('Retry from the Help menu');await collect()

 const text=seen.join('\n')
 expect(text.length).toBeGreaterThan(1000)
 for(const forbidden of [/Windows/,/\btray\b/i,/PowerShell/,/\bCtrl\b/,/\bF1[01]\b/,/Alt\+/])expect(text).not.toMatch(forbidden)
})
