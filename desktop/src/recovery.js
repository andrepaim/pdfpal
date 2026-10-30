const bridge = window.pdfpalDesktop
async function refresh() {
  try {
    const state = await bridge.recovery()
    document.getElementById('title').textContent = state.title
    document.getElementById('detail').textContent = state.detail
    document.getElementById('retry').disabled = state.starting
    document.getElementById('existing').hidden = !state.existing
  } catch { document.getElementById('status').textContent = 'Try reopening pdfpal from the tray.' }
}
document.getElementById('retry').onclick = () => bridge.retryService()
document.getElementById('existing').onclick = () => bridge.openExisting()
document.getElementById('quit').onclick = () => bridge.quit()
document.getElementById('diagnostics').onclick = async () => {
  document.getElementById('report').textContent = JSON.stringify(await bridge.diagnostics(), null, 2)
  document.getElementById('preview').hidden = false
}
document.getElementById('export').onclick = async () => {
  document.getElementById('status').textContent = await bridge.exportDiagnostics() ? 'Report exported.' : 'Export cancelled.'
}
void refresh()

document.getElementById('updates').onclick = async () => {
  const button = document.getElementById('updates')
  button.disabled = true
  document.getElementById('update-preview').hidden = false
  document.getElementById('update-description').textContent = 'Checking official desktop releases…'
  try {
    const result = await bridge.checkUpdates()
    document.getElementById('update-description').textContent = result.state === 'available' ? `Version ${result.version} is available. Download the installer, quit pdfpal, then run it.` : result.state === 'current' ? `You’re up to date (${result.currentVersion}).` : result.state === 'unpublished' ? 'No signed desktop release has been published yet.' : result.message
    document.getElementById('download-update').hidden = result.state !== 'available'
  } catch { document.getElementById('update-description').textContent = 'Could not check for updates. Try again later.' }
  finally { button.disabled = false }
}
document.getElementById('download-update').onclick = () => bridge.downloadUpdate()
document.getElementById('release-notes').onclick = () => bridge.releaseNotes()
