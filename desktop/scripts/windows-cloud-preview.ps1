param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [string]$WorkRoot=(Join-Path $env:TEMP 'pdfpal-windows-cloud-preview'),
  [string]$ToolsRoot=''
)
$ErrorActionPreference='Stop'
function Run-Checked([scriptblock]$Command) { & $Command; if ($LASTEXITCODE -ne 0) { throw "Command failed: $LASTEXITCODE" } }
New-Item -ItemType Directory -Force $WorkRoot | Out-Null
$stage=Join-Path $WorkRoot 'stage'
New-Item -ItemType Directory -Force $stage | Out-Null
foreach($generated in @('dist','frontend/dist')){if(Test-Path (Join-Path $stage $generated)){Remove-Item (Join-Path $stage $generated) -Recurse -Force}}
foreach($entry in Get-ChildItem (Join-Path $SourceRoot 'desktop/stage')) {
  if($entry.Name -ne 'node_modules'){Copy-Item $entry.FullName $stage -Recurse -Force}
}
Copy-Item (Join-Path $SourceRoot 'desktop/build') $WorkRoot -Recurse -Force
Copy-Item (Join-Path $SourceRoot 'desktop/electron-builder.yml') $WorkRoot -Force
if(-not $ToolsRoot){
  $ToolsRoot=Join-Path $WorkRoot 'tools'
  New-Item -ItemType Directory -Force $ToolsRoot | Out-Null
  Copy-Item (Join-Path $SourceRoot 'desktop/package.json') $ToolsRoot -Force
  Copy-Item (Join-Path $SourceRoot 'desktop/package-lock.json') $ToolsRoot -Force
  Run-Checked { npm.cmd ci --prefix $ToolsRoot --ignore-scripts --no-audit --no-fund }
}
Run-Checked { npm.cmd ci --prefix $stage --omit=dev --ignore-scripts --no-audit --no-fund }
Run-Checked { node (Join-Path $SourceRoot 'desktop/scripts/notices.mjs') $stage $SourceRoot }
$driver=@'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.argv[2],tools=process.argv[3],pkgPath=path.join(root,'stage/package.json');
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
pkg.name='pdfpal-cloud-preview';pkg.pdfpalDesktop={appId:'io.pdfpal.desktop.cloud-preview',distribution:'unsigned',cloudPreview:true};
fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2));
const config={compression:'store',extends:path.join(root,'electron-builder.yml'),appId:'io.pdfpal.desktop.cloud-preview',productName:'pdfpal Cloud Preview',executableName:'pdfpal-cloud',forceCodeSigning:false,
 win:{signExecutable:false},nsis:{shortcutName:'pdfpal Cloud Preview',uninstallDisplayName:'pdfpal Cloud Preview',artifactName:'pdfpal-Cloud-Preview-Setup-${version}-${arch}.exe'},
 directories:{output:path.join(root,'artifacts')},extraMetadata:{pdfpalDesktop:pkg.pdfpalDesktop}};
const configPath=path.join(root,'cloud-preview-build.json');fs.writeFileSync(configPath,JSON.stringify(config,null,2));
const result=spawnSync(process.execPath,[path.join(tools,'node_modules/electron-builder/cli.js'),'--projectDir',root,'--config',configPath,'--win','--x64','--publish','never'],{cwd:root,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
process.exit(result.status??1);
'@
$driverPath=Join-Path $WorkRoot 'build-cloud-preview.cjs'
Set-Content $driverPath $driver -Encoding UTF8
Run-Checked { node $driverPath $WorkRoot $ToolsRoot }
Write-Host "Cloud preview installer built in $WorkRoot\artifacts"
