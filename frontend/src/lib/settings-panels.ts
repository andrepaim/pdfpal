import {useEffect} from 'react'
export type SettingsPanel='cloud'|'backups'|'privacy'|'updates'|'cli'
export function openSettingsPanel(panel:SettingsPanel){window.dispatchEvent(new CustomEvent('pdfpal:open-panel',{detail:panel}))}
export function useSettingsPanel(panel:SettingsPanel,open:()=>void){
 useEffect(()=>{const listener=(event:Event)=>{if((event as CustomEvent).detail===panel)open()};window.addEventListener('pdfpal:open-panel',listener);return()=>window.removeEventListener('pdfpal:open-panel',listener)},[panel,open])
}
