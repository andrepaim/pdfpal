import {useSettingsPanel} from '../lib/settings-panels'
import {useEffect,useRef,useState} from 'react'
import {configureTelemetry} from '../lib/telemetry'
import './cloud-settings.css'

type SafeReport={format:1;code:string;appVersion:string;platform:string;at:number;durationMs:number}
type Reports={sharing:boolean;signedIn:boolean;pending:number;status:string;records:{id:string;event:SafeReport;sent:boolean}[]}
async function api<T>(route:string,method='GET',body?:unknown):Promise<T>{const response=await fetch(`/api/telemetry/${route}`,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.detail||'Could not update diagnostic settings. Please retry.');return data}
export default function TelemetrySettings(){
 const dialog=useRef<HTMLDialogElement>(null)
 const [consent,setConsent]=useState({diagnostics:false,usage:false}),[reports,setReports]=useState<Reports>(),[shared,setShared]=useState<{id:string;event:SafeReport}[]>(),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false)
 useEffect(()=>{void api<typeof consent>('consent').then(c=>{setConsent(c);return configureTelemetry(c)}).catch(()=>{})},[])
 async function refresh(){setReports(await api<Reports>('reports'))}
 useEffect(()=>{if(open)void refresh().catch(()=>setError('Could not load error reporting status.'))},[open])
 async function action(work:()=>Promise<unknown>){setSaving(true);setError('');try{await work();await refresh()}catch(e){setError(e instanceof Error?e.message:'Please retry.')}finally{setSaving(false)}}
 async function update(next:typeof consent){const previous=consent;setConsent(next);try{const result=await api<typeof consent>('consent','POST',next);setConsent(result);await configureTelemetry(result).catch(()=>{})}catch(error){setConsent(previous);throw error}}
 async function share(enabled:boolean){const previous=reports;setReports(previous?{...previous,sharing:enabled}:previous);try{await api('reports/consent','POST',{enabled})}catch(error){setReports(previous);throw error}}
 useSettingsPanel('privacy',()=>{setOpen(true);if(!dialog.current?.open)dialog.current?.showModal()})
 function close(){dialog.current?.close();setOpen(false)}
 function download(){const blob=new Blob([JSON.stringify({format:1,reports:reports?.records.map(r=>r.event)??[]},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='pdfpal-error-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <>
  <button className="privacy-launcher" aria-haspopup="dialog" onClick={()=>{setOpen(true);dialog.current?.showModal()}}>Privacy</button>
  <dialog ref={dialog} className="ai-settings cloud-settings" aria-labelledby="privacy-title" onCancel={e=>{e.preventDefault();close()}} onClose={()=>setOpen(false)}>
   <header className="ai-settings-header cloud-header"><div><span className="ai-settings-eyebrow">DIAGNOSTICS</span><h2 id="privacy-title">Privacy & error reports</h2><p>Choose what stays local and what you share.</p></div><button className="ai-settings-close" aria-label="Close privacy settings" onClick={close}>×</button></header>
   <div className="ai-settings-content cloud-content">
    {error&&<p className="cloud-callout cloud-callout--error" role="alert">{error}</p>}
    <section className="cloud-section"><h3>On this device</h3><p className="cloud-description">Keep a small diagnostic history to troubleshoot problems.</p><label className="recovery-toggle"><input type="checkbox" disabled={saving} checked={consent.diagnostics} onChange={e=>void action(()=>update({...consent,diagnostics:e.target.checked}))}/>Diagnostic reporting</label><p className="cloud-field-help">This setting records local operation results. Sharing error reports is a separate choice below.</p></section>
    <section className="cloud-section"><h3>Share error reports</h3><p className="cloud-description">Send error codes and basic timing to your private Firebase account. Includes app version and operating system. Excludes documents, questions, answers, titles, filenames, paths and raw error messages.</p><label className="recovery-toggle"><input type="checkbox" disabled={saving||!reports} checked={reports?.sharing??false} onChange={e=>void action(()=>share(e.target.checked))}/>Share error reports with Firebase</label><p className="cloud-field-help">Off by default. Requires Google sign-in. At most 20 new reports per device per day; repeated errors are grouped. The app keeps up to 200 reports for 30 days and removes older shared reports when it connects. Turning this off stops new uploads; use Remove shared reports to delete previously sent reports.</p>
     <p className="cloud-description" role="status">{reports?.signedIn?reports.sharing?`${reports.pending} reports waiting to send. ${reports.status}`:'Sharing is off.':'Sign in through Cloud library to send or manage shared reports.'}</p>
     <div className="recovery-actions"><button className="cloud-secondary" disabled={saving||!reports?.sharing||!reports?.signedIn} onClick={()=>void action(()=>api('reports/retry','POST',{}))}>Send pending reports</button><button className="cloud-secondary" disabled={saving||!reports?.signedIn} onClick={()=>void action(async()=>setShared(await api('reports/shared')))}>View shared reports</button><button className="cloud-text-button" disabled={saving||!reports?.signedIn} onClick={()=>setConfirm(true)}>Remove shared reports</button></div>
     {confirm&&<div className="cloud-callout"><strong>Remove all reports for your signed-in account?</strong><p>Your library and documents stay in place.</p><div className="recovery-actions"><button className="cloud-secondary" disabled={saving} onClick={()=>void action(async()=>{await api('reports/shared','DELETE');setShared([]);setConfirm(false)})}>Remove reports</button><button className="cloud-text-button" onClick={()=>setConfirm(false)}>Cancel</button></div></div>}
    </section>
    <section className="cloud-section"><h3>Usage analytics</h3><label className="recovery-toggle"><input type="checkbox" disabled={saving} checked={consent.usage} onChange={e=>void action(()=>update({...consent,usage:e.target.checked}))}/>Usage analytics</label><p className="cloud-field-help">Optional feature measurements. Analytics only runs if this installation has an Analytics configuration.</p></section>
    <section className="cloud-section"><div className="cloud-section-heading"><h3>{shared?'Shared reports':'Recent local error reports'}</h3>{shared&&<button className="cloud-text-button" onClick={()=>setShared(undefined)}>Show local</button>}</div>
     {(shared??reports?.records??[]).length===0&&<p className="cloud-description">No reports to show.</p>}{(shared??reports?.records??[]).map(r=><article className="recovery-item" key={r.id}><strong>{r.event.code.replaceAll('_',' ')}</strong><p>{new Date(r.event.at).toLocaleString()} · v{r.event.appVersion} · {r.event.platform}{r.event.durationMs?` · ${r.event.durationMs} ms`:''}</p></article>)}
     <div className="recovery-actions"><button className="cloud-secondary" disabled={!reports?.records.length} onClick={download}>Download safe report</button><button className="cloud-text-button" disabled={saving} onClick={()=>void action(()=>api('reports/local','DELETE'))}>Clear local error reports</button></div>
    </section>
   </div><footer className="ai-settings-footer cloud-footer"><button className="cloud-secondary" onClick={close}>Close</button></footer>
  </dialog>
 </>
}
