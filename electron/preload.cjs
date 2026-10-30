const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('app:version'),
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (data) => ipcRenderer.invoke('store:save', data),
  },
  media: {
    save: (url, id, ext) => ipcRenderer.invoke('media:save', url, id, ext),
    saveBuffer: (data, id, ext) => ipcRenderer.invoke('media:saveBuffer', data, id, ext),
    delete: (files) => ipcRenderer.invoke('media:delete', files),
    reveal: (url) => ipcRenderer.invoke('media:reveal', url),
    open: (url) => ipcRenderer.invoke('media:open', url),
    read: (url) => ipcRenderer.invoke('media:read', url),
  },
  license: {
    getMachineId: () => ipcRenderer.invoke('license:machine-id'),
    getState: () => ipcRenderer.invoke('license:get-state'),
    checkin: () => ipcRenderer.invoke('license:checkin'),
    activate: (code) => ipcRenderer.invoke('license:activate', code),
    reset: () => ipcRenderer.invoke('license:reset'),
    onUpdate: (callback) => {
      ipcRenderer.on('license:update', (_event, state) => callback(state))
    },
  },
  dataPath: () => ipcRenderer.invoke('app:dataPath'),
})
