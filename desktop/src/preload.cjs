const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pdfpalDesktop', {
  setAgent: agent => ipcRenderer.invoke('pdfpal:set-agent', agent),
  onAgentChanged: callback => {
    const listener = (_event, agent) => callback(agent)
    ipcRenderer.on('pdfpal:agent-changed', listener)
    return () => ipcRenderer.removeListener('pdfpal:agent-changed', listener)
  },
})
