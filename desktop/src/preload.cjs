const { contextBridge, ipcRenderer } = require('electron')
let openSettings
let settingsPending = false
ipcRenderer.on('pdfpal:open-ai-settings', () => {
  if (openSettings) openSettings()
  else settingsPending = true
})

contextBridge.exposeInMainWorld('pdfpalDesktop', {
  setAgent: agent => ipcRenderer.invoke('pdfpal:set-agent', agent),
  onOpenAISettings: callback => {
    openSettings = callback
    if (settingsPending) queueMicrotask(() => {
      if (settingsPending && openSettings) { settingsPending = false; openSettings() }
    })
    return () => { if (openSettings === callback) openSettings = undefined }
  },
  onAgentChanged: callback => {
    const listener = (_event, agent) => callback(agent)
    ipcRenderer.on('pdfpal:agent-changed', listener)
    return () => ipcRenderer.removeListener('pdfpal:agent-changed', listener)
  },
})
