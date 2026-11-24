import {test,expect,type Page} from '@playwright/test'
import {mockAuth} from './helpers'

test.beforeEach(async({page})=>{
 await mockAuth(page)
 await page.addInitScript(()=>{
  let connected=false,busy=false,hasModels=true
  let active='a'
  const models: Record<string, string> = { a: 'eligible-model', b: 'eligible-model' }
  const effortDefaults: Record<string, Record<string, string>> = { a: { 'eligible-model': 'low' }, b: { 'eligible-model': 'high' } }
  const snapshot=()=>({connected,busy,active,accounts:connected?[{id:'a',label:'Reader account with a long display name',connected:true},{id:'b',label:'Second reader',connected:true}]:[],models:connected&&hasModels?[{id:'eligible-model',name:'Eligible model with a long descriptive name',efforts:['low','high']},{id:'other-model',name:'Other model',efforts:['medium','high'],defaultEffort:'medium'}]:[],model:models[active],effortDefaults:effortDefaults[active],message:connected?'ChatGPT connected. Eligible requests use your plan.':''})
  window.pdfpalDesktop={
   completeSetup:async()=>{localStorage.setItem('chatgpt-onboarding','complete');return true},
   setupState:async()=>{
    if(localStorage.getItem('hold-setup-state'))await new Promise<void>(resolve=>window.addEventListener('release-setup-state',()=>resolve(),{once:true}))
    return {default:localStorage.getItem('direct-mode')||'codex',complete:true,explicit:true,agents:[{id:'chatgpt',label:'ChatGPT',available:connected,auth:connected?'account':'signed_out'},{id:'claude',label:'Claude',available:true,auth:'account'},{id:'codex',label:'Codex',available:true,auth:'account'}]}
   },
   setAgent:async id=>{if(localStorage.getItem('save-error'))throw Error('fixture');localStorage.setItem('direct-mode',id);return id},
   onAgentChanged:()=>()=>{},
   chatgpt:async(action,...args)=>{
    localStorage.setItem('chatgpt-state-calls',String(Number(localStorage.getItem('chatgpt-state-calls')||0)+(action==='state'?1:0)))
    if(action==='connect'){
     if(localStorage.getItem('connection-mode')==='pending')busy=true
     else {connected=true;hasModels=localStorage.getItem('connection-mode')!=='no-models'}
    }
    if(action==='cancel'){busy=false;localStorage.setItem('chatgpt-cancelled','true')}
    if(action==='models')hasModels=true
    if(action==='disconnect')connected=false
    if(action==='select'){active=String(args[0]);if(args[1])models[active]=String(args[1])}
    if(action==='efforts'){
     if(!connected||args[0]!==active)throw Error('Account changed.')
     if(localStorage.getItem('chatgpt-efforts-error'))throw Error('Preferences could not be saved.')
     localStorage.setItem('chatgpt-effort-write',JSON.stringify(args))
     for(const [id,effort] of Object.entries(args[1] as Record<string,string>)){
      if(effort)effortDefaults[active][id]=effort
      else delete effortDefaults[active][id]
     }
    }
    if(action==='usage'&&localStorage.getItem('usage-error'))throw Error('Usage settings could not open.')
    return snapshot()
   }
  }
 })
})

async function openSettings(page:Page){
 await page.goto('/')
 await page.evaluate(()=>window.dispatchEvent(new Event('pdfpal-open-ai-settings')))
 const modal=page.getByRole('dialog',{name:'AI assistant',exact:true})
 await expect(modal).toBeVisible()
 await expect(modal.getByRole('button',{name:'Continue with ChatGPT',exact:true})).toBeEnabled()
 return modal
}

async function releaseSetupState(page:Page){
 await page.evaluate(()=>{
  localStorage.removeItem('hold-setup-state')
  window.dispatchEvent(new Event('release-setup-state'))
 })
}

test('ChatGPT appears once in the same provider cards and saves through the shared footer',async({page})=>{
 const modal=await openSettings(page)
 await expect(modal.getByRole('radio',{name:/ChatGPT/})).toHaveCount(1)
 await expect(modal.locator('.ai-settings-card')).toHaveCount(3)
 const cards=await modal.locator('.ai-settings-card').evaluateAll(elements=>elements.map(element=>({width:element.getBoundingClientRect().width,padding:getComputedStyle(element.querySelector('.ai-settings-option')!).padding})))
 expect(new Set(cards.map(c=>c.width)).size).toBe(1)
 expect(new Set(cards.map(c=>c.padding)).size).toBe(1)
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByRole('radio',{name:/ChatGPT/})).toBeChecked()
 await expect(modal.getByLabel('ChatGPT model')).toHaveValue('eligible-model')
 await modal.getByLabel('ChatGPT account').selectOption('b')
 await modal.getByLabel('ChatGPT model').selectOption('other-model')
 await page.evaluate(()=>localStorage.setItem('hold-setup-state','true'))
 await modal.getByRole('button',{name:'Check again',exact:true}).click()
 await expect(modal.getByText('Checking installed assistants…')).toBeVisible()
 await releaseSetupState(page)
 await expect(modal.getByRole('radio',{name:/ChatGPT/})).toBeChecked()
 await expect(modal.getByLabel('ChatGPT account')).toHaveValue('b')
 await expect(modal.getByLabel('ChatGPT model')).toHaveValue('other-model')
 await modal.getByRole('button',{name:'Use assistant',exact:true}).click()
 await expect(modal).not.toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('direct-mode'))).toBe('chatgpt')
 expect(await page.evaluate(()=>localStorage.getItem('pdfpal.agent'))).toBe('chatgpt')
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-onboarding'))).toBeNull()
})

test('ChatGPT settings save model efforts to the active account and keep drafts after a failed save',async({page})=>{
 const modal=await openSettings(page)
 const reopen=async()=>page.evaluate(()=>window.dispatchEvent(new Event('pdfpal-open-ai-settings')))
 const model=modal.getByLabel('ChatGPT model')
 const account=modal.getByLabel('ChatGPT account')
 const effort=modal.getByLabel('Default reasoning effort')
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(effort).toHaveValue('low')
 await effort.selectOption('high')
 await modal.getByRole('button',{name:'Cancel',exact:true}).click()
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-effort-write'))).toBeNull()

 const exposedPreviousSelection=await page.evaluate(()=>{
  localStorage.setItem('hold-setup-state','true')
  window.dispatchEvent(new Event('pdfpal-open-ai-settings'))
  return !!document.querySelector('.ai-settings[open] input[value="chatgpt"]:checked')
 })
 expect(exposedPreviousSelection).toBe(false)
 await expect(modal.getByText('Checking installed assistants…')).toBeVisible()
 await expect(modal.getByRole('radio',{name:/ChatGPT/})).toHaveCount(0)
 await releaseSetupState(page)
 await expect(modal.getByRole('radio',{name:/Codex/})).toBeChecked()
 await modal.getByRole('radio',{name:/ChatGPT/}).check()
 await expect(effort).toHaveValue('low')
 await effort.selectOption('')
 await model.selectOption('other-model')
 await effort.selectOption('high')
 await model.selectOption('eligible-model')
 await expect(effort).toHaveValue('')
 await account.selectOption('b')
 await expect(effort).toHaveValue('high')
 await account.selectOption('a')
 await expect(effort).toHaveValue('')
 await page.evaluate(()=>localStorage.setItem('chatgpt-efforts-error','true'))
 await modal.getByRole('button',{name:'Use assistant',exact:true}).click()
 await expect(modal.getByRole('alert')).toContainText('could not be saved')
 await expect(effort).toHaveValue('')
 await page.evaluate(()=>localStorage.removeItem('chatgpt-efforts-error'))
 await modal.getByRole('button',{name:'Use assistant',exact:true}).click()
 await expect(modal).not.toBeVisible()
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chatgpt-effort-write')!)))
  .toEqual(['a',{'eligible-model':'','other-model':'high'}])

 await reopen()
 await modal.getByRole('radio',{name:/ChatGPT/}).check()
 await expect(model).toHaveValue('eligible-model')
 await expect(effort).toHaveValue('')
 await model.selectOption('other-model')
 await expect(effort).toHaveValue('high')
 await account.selectOption('b')
 await expect(effort).toHaveValue('high')
 await model.selectOption('other-model')
 await expect(effort).toHaveValue('')
})

test('a connected account without eligible models cannot be saved until models load',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('connection-mode','no-models'))
 const modal=await openSettings(page)
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeDisabled()
 await expect(modal.getByLabel('ChatGPT model')).toBeDisabled()
 await modal.getByRole('button',{name:'Refresh models',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeEnabled()
 await modal.getByRole('button',{name:'Disconnect',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeDisabled()
 await expect(modal.getByRole('radio',{name:/ChatGPT/})).toBeDisabled()
 await modal.getByRole('radio',{name:/Codex/}).check()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeEnabled()
})

test('ChatGPT errors stay inline and signing in can be cancelled without saving',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('connection-mode','pending');localStorage.setItem('usage-error','true')})
 const modal=await openSettings(page)
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByText('Waiting for browser sign-in')).toBeVisible()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeDisabled()
 await modal.getByRole('button',{name:'Cancel sign-in',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Continue with ChatGPT',exact:true})).toBeEnabled()
 await modal.getByRole('button',{name:'Manage usage ↗',exact:true}).click()
 await expect(modal.getByRole('alert')).toHaveText('Usage settings could not open.')
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeEnabled()
 await page.keyboard.press('Escape')
 await expect(modal).not.toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-cancelled'))).toBe('true')
 expect(await page.evaluate(()=>localStorage.getItem('direct-mode'))).toBeNull()
})

test('ChatGPT model fields fit a narrow display and footer actions stay visible',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:600})
 const modal=await openSettings(page)
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByLabel('ChatGPT account')).toBeVisible()
 await expect(modal.getByLabel('ChatGPT model')).toBeVisible()
 await expect(modal.getByRole('button',{name:'Use assistant',exact:true})).toBeInViewport()
 await expect(modal.getByRole('button',{name:'Close AI settings',exact:true})).toBeInViewport()
 expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true)
 const dimensions=await modal.locator('.ai-settings-provider-fields').evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,columns:getComputedStyle(element).gridTemplateColumns.split(' ').length}))
 expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width)
 expect(dimensions.columns).toBe(1)
 await modal.screenshot({path:testInfo.outputPath('chatgpt-settings-narrow.png')})
})

test('ChatGPT state stops polling when settings are closed',async({page})=>{
 const modal=await openSettings(page)
 await page.keyboard.press('Escape');await expect(modal).not.toBeVisible()
 const calls=await page.evaluate(()=>localStorage.getItem('chatgpt-state-calls'))
 await page.waitForTimeout(2300)
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-state-calls'))).toBe(calls)
})

test('first-run ChatGPT selection uses the same Start reading action and completes onboarding',async({page})=>{
 await page.addInitScript(()=>{window.pdfpalDesktop!.setupStatus=async()=>({complete:false})})
 await page.goto('/')
 const modal=page.getByRole('dialog',{name:'Connect your reading assistant',exact:true})
 await expect(modal).toBeVisible()
 await modal.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(modal.getByRole('button',{name:'Start reading',exact:true})).toBeEnabled()
 await modal.getByRole('button',{name:'Start reading',exact:true}).click()
 await expect(modal).not.toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-onboarding'))).toBe('complete')
 expect(await page.evaluate(()=>localStorage.getItem('direct-mode'))).toBe('chatgpt')
})
