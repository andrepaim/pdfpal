import {useEffect,useState} from 'react'
export type ChatGPTState={connected:boolean;busy:boolean;active:string|null;accounts:{id:string;label:string;connected:boolean}[];models:{id:string;name:string}[];model:string;message:string}
export default function ChatGPTSettings(){
 const bridge=window.pdfpalDesktop
 const [state,setState]=useState<ChatGPTState>(),[error,setError]=useState(''),[working,setWorking]=useState(false)
 async function act(action:string,...args:unknown[]){setWorking(true);setError('');try{setState(await bridge!.chatgpt!(action,...args))}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''))}finally{setWorking(false)}}
 useEffect(()=>{if(!bridge?.chatgpt)return;let active=true;const refresh=()=>{void bridge.chatgpt!('state').then(s=>{if(active)setState(s)}).catch(()=>{})};refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[bridge])
 if(!bridge?.chatgpt)return null
 return <section className="ai-settings-card" aria-label="ChatGPT plan connection"><h3>ChatGPT · use your plan</h3><p>Help with difficult passages using an eligible ChatGPT account.</p>{error&&<p role="alert">{error}</p>}{state?.message&&<p role="status">{state.message}</p>}
 <div className="ai-settings-actions"><button type="button" disabled={working||state?.busy} onClick={()=>void act('connect',state?.active||undefined)}>Continue with ChatGPT</button>{state?.busy&&<button type="button" onClick={()=>void act('cancel')}>Cancel sign-in</button>}</div>
 {!!state?.accounts.length&&<button type="button" disabled={working||state.busy} onClick={()=>void act('connect')}>Add another ChatGPT account</button>}
 {!!state?.accounts.length&&<label>ChatGPT account<select aria-label="ChatGPT account" value={state.active||''} disabled={working||state.busy} onChange={e=>void act('select',e.target.value)}>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
 {state?.connected&&<><label>ChatGPT model<select aria-label="ChatGPT model" value={state.model} disabled={working} onChange={e=>void act('select',state.active,e.target.value)}>{state.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><div className="ai-settings-actions"><button type="button" disabled={working} onClick={()=>void act('models')}>Refresh models</button><button type="button" disabled={working} onClick={()=>void act('disconnect')}>Disconnect ChatGPT</button><button type="button" disabled={working||!state.model} onClick={()=>{setWorking(true);void bridge.setAgent('chatgpt').then(()=>{localStorage.setItem('pdfpal.agent','chatgpt');return bridge.completeSetup?.()}).then(()=>{window.dispatchEvent(new Event('pdfpal-chatgpt-selected'))}).catch(e=>setError(e.message)).finally(()=>setWorking(false))}}>Use ChatGPT</button></div><p>Eligible requests use your ChatGPT plan. Provider limits apply.</p></>}
 <button type="button" onClick={()=>void bridge.chatgpt!('usage')}>Manage ChatGPT usage ↗</button>
 </section>
}
