// 预加载：向渲染进程暴露最小可用 API（端口 / 打开目录等）。
const { contextBridge, ipcRenderer } = require('electron')

function readPort() {
  const arg = process.argv.find((a) => a.startsWith('--jueman-port='))
  if (arg) {
    const n = parseInt(arg.split('=')[1], 10)
    if (Number.isFinite(n)) return n
  }
  return 8642
}

contextBridge.exposeInMainWorld('jueman', {
  port: readPort(),
  isElectron: true,
  platform: process.platform,
  openPath: (p) => ipcRenderer.invoke('jueman:open-path', p),
  revealPath: (p) => ipcRenderer.invoke('jueman:reveal-path', p),
  openExternal: (url) => ipcRenderer.invoke('jueman:open-external', url),
  info: () => ipcRenderer.invoke('jueman:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
})

contextBridge.exposeInMainWorld('licenseAPI', {
  getMachineId: () => ipcRenderer.invoke('license:machine-id'),
  activate: (code) => ipcRenderer.invoke('license:activate', code),
  resetLicense: () => ipcRenderer.invoke('license:reset'),
})
