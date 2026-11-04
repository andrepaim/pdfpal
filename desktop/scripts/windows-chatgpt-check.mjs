// Native Windows driver: run with Windows Node; no PowerShell policy changes.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
if(process.platform!=='win32')throw Error('Run this driver with Windows Node.')
const source=path.resolve(process.argv[2]),work=path.resolve(process.argv[3])
if(!source||!work||work===source)throw Error('Use a separate temporary work directory.')
const stage=path.join(work,'stage'),tools=path.join(work,'tools')
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(tools,{recursive:true})
for(const entry of fs.readdirSync(path.join(source,'desktop/stage')))if(entry!=='node_modules')fs.cpSync(path.join(source,'desktop/stage',entry),path.join(stage,entry),{recursive:true})
for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,'desktop',file),path.join(tools,file))
fs.cpSync(path.join(source,'desktop/build'),path.join(work,'build'),{recursive:true});fs.copyFileSync(path.join(source,'desktop/electron-builder.yml'),path.join(work,'electron-builder.yml'))
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
const run=(file,args,cwd=work)=>execFileSync(process.execPath,[file,...args],{cwd,stdio:'inherit',env:process.env})
run(npm,['ci','--prefix',tools,'--ignore-scripts','--no-audit','--no-fund'])
run(npm,['ci','--prefix',stage,'--omit=dev','--ignore-scripts','--no-audit','--no-fund'])
run(path.join(source,'desktop/scripts/notices.mjs'),[stage,source])
run(path.join(tools,'node_modules/electron-builder/cli.js'),['--config',path.join(work,'electron-builder.yml'),'--win','--x64','--dir','-c.directories.output=artifacts-candidate'])
console.log('Windows unpacked app ready at '+path.join(work,'artifacts-candidate/win-unpacked/pdfpal.exe'))
