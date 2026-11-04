import { createHash } from 'node:crypto'
export type Attempt = { state:string; nonce:string; verifier:string; redirect:string; clientId?:string }
export function authorization(a:Attempt,host:string) {
 const url=new URL('https://auth.openai.com/api/accounts/authorize')
 const params:Record<string,string>={client_id:a.clientId||'dynamic_agent_client',ext_agent_host_id:host,response_type:'code',redirect_uri:a.redirect,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:'https://api.openai.com/v1',state:a.state,nonce:a.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(a.verifier).digest('base64url')}
 if(!a.clientId)params.agent_name_hint='pdfpal'
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v)
 return url.href
}
export function callback(a:Attempt,value:string) {
 const url=new URL(value),expected=new URL(a.redirect),p=url.searchParams
 if(url.origin!==expected.origin||url.pathname!==expected.pathname||url.username||url.password||url.hash||[...p.keys()].length!==new Set(p.keys()).size||p.get('state')!==a.state)throw new Error('Invalid sign-in callback')
 if(p.has('error'))throw new Error(p.get('error')==='access_denied'?'Plan authorization was declined.':'Sign-in failed.')
 const clientId=p.get('client_id')||a.clientId,code=p.get('code')
 if(!clientId||clientId==='dynamic_agent_client'||!code||(a.clientId&&clientId!==a.clientId))throw new Error('Invalid client registration')
 return {clientId,code}
}
export function requestBody(model:string,instructions:string,input:string) {return {model,instructions,input:[{role:'user',content:input}],store:false,stream:true} as const}
export async function readResponse(stream:ReadableStream<Uint8Array>,delta:(text:string)=>void):Promise<string> {
 const reader=stream.getReader(),decoder=new TextDecoder();let buffer='',answer='',complete=false
 function dispatch(frame:string){
  const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')
  if(!data||data==='[DONE]')return
  const event=JSON.parse(data)
  if(event.type==='response.output_text.delta'){if(complete)throw new Error('Unexpected output after completion');answer+=event.delta;if(answer.length>128000)throw new Error('Answer exceeded the size limit');delta(answer)}
  if(event.type==='response.completed')complete=true
  if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error('ChatGPT request failed: '+String(event.response?.error?.code||event.error?.code||event.code||event.type).replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,100))
 }
 try{while(true){const r=await reader.read();buffer+=decoder.decode(r.value,{stream:!r.done}).replace(/\r\n/g,'\n');if(buffer.length>2*1024*1024)throw new Error('Response frame exceeded the size limit');let end;while((end=buffer.indexOf('\n\n'))>=0){dispatch(buffer.slice(0,end));buffer=buffer.slice(end+2)}if(r.done)break}if(buffer.trim())dispatch(buffer);if(!complete)throw new Error('The stream ended without a completed answer.');return answer}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
