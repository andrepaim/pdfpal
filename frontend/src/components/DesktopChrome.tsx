import {useLibraryChanges} from '../lib/library-changes'
import {useCallback,useEffect,useRef,useState,type KeyboardEvent} from 'react'
import {useLocation,useNavigate} from 'react-router-dom'
import type {DesktopChromeState} from '../desktop'
import {projectsApi,type Project} from '../lib/api'
import {flushPendingSaves} from '../lib/persistence'
import {openSettingsPanel,type SettingsPanel} from '../lib/settings-panels'
import './desktop-chrome.css'

function Icon({name}:{name:'menu'|'back'|'forward'|'search'|'help'|'cloud'|'folder'|'chevron'}){
 const paths={menu:'M4 6h16M4 12h16M4 18h16',back:'m14 6-6 6 6 6M8 12h12',forward:'m10 6 6 6-6 6M4 12h12',search:'m16 16 4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',help:'M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.2-1 2.2M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',cloud:'M7 18h11a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12-1A4.5 4.5 0 0 0 7 18Z',folder:'M3 7h6l2 2h10v11H3ZM3 7V4h7l2 3',chevron:'m8 10 4 4 4-4'}
 return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[name]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
const initial:DesktopChromeState={version:'',focused:true,maximized:false,fullscreen:false,canGoBack:false,canGoForward:false,zoom:1}
export default function DesktopChrome(){
 const bridge=window.pdfpalDesktop,enabled=!!bridge?.chrome
 const navigate=useNavigate(),location=useLocation()
 const [state,setState]=useState(initial),[menu,setMenu]=useState(false),[finding,setFinding]=useState(false),[projects,setProjects]=useState<Project[]>([]),[query,setQuery]=useState(''),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(0)
 const menuRef=useRef<HTMLDivElement>(null),menuButton=useRef<HTMLButtonElement>(null),finder=useRef<HTMLDialogElement>(null),searchButton=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null),request=useRef(0)
 useLibraryChanges(()=>enabled?refreshProjects():undefined)
 const update=useCallback((next:DesktopChromeState)=>setState(next),[])
 const refreshProjects=useCallback(async()=>{const id=++request.current;setLoading(true);setFailed(false);try{const items=await projectsApi.list();if(id===request.current)setProjects(items)}catch{if(id===request.current)setFailed(true)}finally{if(id===request.current)setLoading(false)}},[])
 useEffect(()=>{if(!enabled)return;let active=true;void bridge?.chromeState?.().then(s=>{if(active)update(s)}).catch(()=>{});const unsubscribe=bridge?.onChromeState?.(update);return()=>{active=false;unsubscribe?.()}},[bridge,enabled,update])
 useEffect(()=>{if(enabled)void refreshProjects()},[enabled,location.pathname,refreshProjects])
 function closeMenu(focus=true){setMenu(false);if(focus)menuButton.current?.focus()}
 function showFinder(){closeMenu(false);setQuery('');setSelected(0);setFinding(true);if(!finder.current?.open)finder.current?.showModal();searchInput.current?.focus();void refreshProjects()}
 function closeFinder(){finder.current?.close();setFinding(false);searchButton.current?.focus()}
 async function go(route:string){try{await flushPendingSaves();closeMenu(false);closeFinder();navigate(route)}catch{setError('Some changes could not be saved. Save your note and try again.')}}
 async function native(command:string){closeMenu();try{await bridge?.chromeCommand?.(command);setError('')}catch{setError('This action could not finish. Save your changes and try again.')}}
 function panel(value:SettingsPanel){if(menu)closeMenu();openSettingsPanel(value)}
 function ai(){if(menu)closeMenu();window.dispatchEvent(new Event('pdfpal-open-ai-settings'))}
 useEffect(()=>bridge?.onChromeCommand?.(command=>{if(document.querySelector('dialog[open]')&&!finder.current?.open)return;if(command==='menu')setMenu(v=>!v);if(command==='find')showFinder();if(command==='home')void go('/');if(command==='ai-settings')ai()}))
 useEffect(()=>{
  if(!enabled)return
  const keydown=(event:globalThis.KeyboardEvent)=>{
   if(event.altKey||event.metaKey)return
   const key=event.key.toLowerCase()
   const command=!event.ctrlKey&&!event.shiftKey&&key==='f10'?'menu':event.ctrlKey&&!event.shiftKey&&key==='k'?'find':event.ctrlKey&&!event.shiftKey&&key===','?'ai-settings':event.ctrlKey&&event.shiftKey&&key==='h'?'home':null
   if(!command||document.querySelector('dialog[open]')&&!finder.current?.open)return
   event.preventDefault()
   if(command==='menu')setMenu(value=>!value)
   if(command==='find')showFinder()
   if(command==='ai-settings')ai()
   if(command==='home')void go('/')
  }
  window.addEventListener('keydown',keydown)
  return()=>window.removeEventListener('keydown',keydown)
 })
 useEffect(()=>{if(!menu)return;const button=menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');button?.focus();const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node)&&!menuButton.current?.contains(event.target as Node))setMenu(false)};window.addEventListener('pointerdown',outside);const blur=()=>setMenu(false);window.addEventListener('blur',blur);return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('blur',blur)}},[menu])
 useEffect(()=>{if(!finding)return;setSelected(0)},[query,finding])
 const filtered=projects.filter(p=>(p.title+' '+(p.description??'')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,30)
 const activeProject=projects.find(p=>location.pathname.startsWith(`/projects/${p.id}`))
 useEffect(()=>{if(finding)document.getElementById(`desktop-project-${selected}`)?.scrollIntoView({block:'nearest'})},[selected,finding])
 function menuKeys(event:KeyboardEvent){const items=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]);const current=items.indexOf(document.activeElement as HTMLButtonElement);let next=current;if(event.key==='Escape'){event.preventDefault();closeMenu();return}if(event.key==='Tab'){closeMenu(false);return}if(event.key==='ArrowDown')next=(current+1)%items.length;else if(event.key==='ArrowUp')next=(current-1+items.length)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else return;event.preventDefault();items[next]?.focus()}
 function finderKeys(event:KeyboardEvent){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelected(index=>Math.max(0,Math.min(filtered.length-1,index+(event.key==='ArrowDown'?1:-1))))}if(event.key==='Enter'&&filtered[selected]){event.preventDefault();void go(`/projects/${filtered[selected].id}`)}}
 if(!enabled)return null
 const item=(label:string,click:()=>void,key?:string)=><button type="button" role="menuitem" onClick={click}><span>{label}</span>{key&&<kbd>{key}</kbd>}</button>
 return <>
  <header className={`desktop-chrome${state.focused?'':' is-inactive'}`} aria-label="pdfpal window toolbar"><div className="desktop-chrome-inner">
   <button type="button" ref={menuButton} className="desktop-chrome-button" aria-label="pdfpal menu" title="pdfpal menu (F10)" aria-haspopup="menu" aria-expanded={menu} aria-controls="desktop-app-menu" onClick={()=>setMenu(v=>!v)}><Icon name="menu"/></button>
   <button type="button" className="desktop-brand" aria-label="All projects" title="All projects" onClick={()=>void go('/')}><img src="/favicon-32.png" alt=""/><span>pdfpal</span></button>
   <nav className="desktop-history" aria-label="Reading history"><button type="button" className="desktop-chrome-button" aria-label="Go back" title="Back (Alt+Left)" disabled={!state.canGoBack} onClick={()=>void native('back')}><Icon name="back"/></button><button type="button" className="desktop-chrome-button" aria-label="Go forward" title="Forward (Alt+Right)" disabled={!state.canGoForward} onClick={()=>void native('forward')}><Icon name="forward"/></button></nav>
   <button type="button" ref={searchButton} className="desktop-project-switcher" aria-haspopup="dialog" aria-label="Find a project" title="Find a project (Ctrl+K)" onClick={showFinder}><Icon name="search"/><span>{activeProject?.title||'Find a project'}</span><kbd>Ctrl K</kbd></button>
   <div className="desktop-chrome-tools"><button type="button" className="desktop-chrome-button" aria-label="Cloud library" title="Cloud library" onClick={()=>panel('cloud')}><Icon name="cloud"/></button><button type="button" className="desktop-chrome-button" aria-label="Help and updates" title="Help and updates" onClick={()=>panel('updates')}><Icon name="help"/></button></div>
  </div></header>
  {menu&&<div ref={menuRef} className="desktop-app-menu" id="desktop-app-menu" role="menu" aria-label="pdfpal menu" onKeyDown={menuKeys}><div className="desktop-menu-heading">LIBRARY</div>{item('All projects',()=>void go('/'),'Ctrl Shift H')}{item('Find a project…',showFinder,'Ctrl K')}<div role="separator"/>{item('Command line & ChatGPT',()=>panel('cli'))}{item('AI settings',ai,'Ctrl ,')}{item('Cloud library',()=>panel('cloud'))}{item('Backups & recovery',()=>panel('backups'))}{item('Privacy & diagnostics',()=>panel('privacy'))}{item('Kindle extension',()=>void go('/extensions'))}<div role="separator"/>{item('Zoom in',()=>void native('zoom-in'),'Ctrl +')}{item('Zoom out',()=>void native('zoom-out'),'Ctrl −')}{item('Actual size',()=>void native('zoom-reset'),'Ctrl 0')}{item(state.fullscreen?'Exit full screen':'Full screen',()=>void native('fullscreen'),'F11')}<div role="separator"/>{item('Software updates',()=>panel('updates'))}{item('Open in browser',()=>void native('open-browser'))}{item('Quit pdfpal',()=>void native('quit'),'Ctrl Q')}<div className="desktop-menu-version">pdfpal {state.version}<span>Made for focused reading</span></div></div>}
  {error&&<div className="desktop-chrome-error" role="alert">{error}<button type="button" aria-label="Dismiss window message" onClick={()=>setError('')}>×</button></div>}
  <dialog ref={finder} className="desktop-finder" aria-labelledby="desktop-finder-title" onCancel={event=>{event.preventDefault();closeFinder()}} onClose={()=>setFinding(false)} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeFinder()}}}>
   <div className="desktop-finder-input"><Icon name="search"/><input ref={searchInput} aria-label="Search projects" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="desktop-project-options" aria-activedescendant={filtered[selected]?`desktop-project-${selected}`:undefined} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={finderKeys} placeholder="Find a project…" autoComplete="off"/><button type="button" onClick={closeFinder} aria-label="Close project finder"><kbd>Esc</kbd></button></div>
   <div className="desktop-finder-label" id="desktop-finder-title">{query?'MATCHING PROJECTS':'YOUR PROJECTS'}</div><div id="desktop-project-options" role="listbox" aria-label="Projects" className="desktop-finder-results">{loading?<p role="status">Loading projects…</p>:failed?<p role="alert">Projects could not be loaded. <button onClick={()=>void refreshProjects()}>Try again</button></p>:!filtered.length?<p>{query?'No projects match your search.':'Create your first project from All projects.'}</p>:filtered.map((project,index)=><button type="button" key={project.id} role="option" aria-selected={index===selected} id={`desktop-project-${index}`} className={index===selected?'is-selected':''} onPointerMove={()=>setSelected(index)} onClick={()=>void go(`/projects/${project.id}`)}><span className="desktop-project-icon"><Icon name="folder"/></span><span><strong>{project.title}</strong><small>{project.description||`${project.source_count} sources · ${project.note_count} notes`}</small></span>{index===selected&&<span className="desktop-finder-enter" aria-hidden="true">↵</span>}</button>)}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><button type="button" onClick={()=>void go('/')}>All projects <span aria-hidden="true">↗</span></button></footer>
  </dialog>
 </>
}
