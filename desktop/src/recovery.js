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
