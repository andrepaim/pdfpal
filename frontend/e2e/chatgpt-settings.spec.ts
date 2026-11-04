import {test,expect} from '@playwright/test'
import {mockAuth} from './helpers'
test('connects ChatGPT and selects an account model without installing an agent',async({page})=>{
 await mockAuth(page)
 await page.addInitScript(()=>{localStorage.setItem('pdfpal.agent','claude');let connected=false;window.pdfpalDesktop={completeSetup:async()=>{localStorage.setItem('chatgpt-onboarding','complete');return true},setAgent:async id=>{localStorage.setItem('direct-mode',id);return id},onAgentChanged:()=>()=>{},chatgpt:async action=>{if(action==='connect')connected=true;return {connected,busy:false,active:'a',accounts:[{id:'a',label:'Reader',connected}],models:connected?[{id:'eligible-model',name:'Eligible model'}]:[],model:'eligible-model',message:connected?'Connected':''}}}})
 await page.goto('/');await page.evaluate(()=>window.dispatchEvent(new Event('pdfpal-open-ai-settings')))
 await page.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click()
 await expect(page.getByLabel('ChatGPT model')).toHaveValue('eligible-model')
 await page.getByRole('button',{name:'Use ChatGPT',exact:true}).click()
 expect(await page.evaluate(()=>localStorage.getItem('direct-mode'))).toBe('chatgpt')
 expect(await page.evaluate(()=>localStorage.getItem('chatgpt-onboarding'))).toBe('complete')
 expect(await page.evaluate(()=>localStorage.getItem('pdfpal.agent'))).toBe('chatgpt')
})
