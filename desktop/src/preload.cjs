const { contextBridge, ipcRenderer } = require('electron')
let openSettings
let settingsPending = false
ipcRenderer.on('pdfpal:open-ai-settings', () => {
  if (openSettings) openSettings()
  else settingsPending = true
})

contextBridge.exposeInMainWorld('pdfpalDesktop', {
  setupStatus: () => ipcRenderer.invoke('pdfpal:setup-status'),
  setupState: () => ipcRenderer.invoke('pdfpal:setup-state'),
  completeSetup: () => ipcRenderer.invoke('pdfpal:complete-setup'),
  setupAction: (agent, action) => ipcRenderer.invoke('pdfpal:setup-action', agent, action),
  chooseBinary: agent => ipcRenderer.invoke('pdfpal:choose-binary', agent),
  testConnection: agent => ipcRenderer.invoke('pdfpal:test-connection', agent),
  cancelTest: () => ipcRenderer.invoke('pdfpal:cancel-test'),
  serviceState: () => ipcRenderer.invoke('pdfpal:service-state'),
  recovery: () => ipcRenderer.invoke('pdfpal:recovery'),
  retryService: () => ipcRenderer.invoke('pdfpal:retry-service'),
  openExisting: () => ipcRenderer.invoke('pdfpal:open-existing'),
  diagnostics: () => ipcRenderer.invoke('pdfpal:diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('pdfpal:export-diagnostics'),
  quit: () => ipcRenderer.invoke('pdfpal:quit'),
  onServiceState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('pdfpal:service-state', listener)
    return () => ipcRenderer.removeListener('pdfpal:service-state', listener)
  },
  onOpenDiagnostics: callback => {
    const listener = () => callback()
    ipcRenderer.on('pdfpal:open-diagnostics', listener)
    return () => ipcRenderer.removeListener('pdfpal:open-diagnostics', listener)
  },
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
