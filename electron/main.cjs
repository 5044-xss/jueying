// 掘影 桌面主进程：只做窗口与本地存储，不再启动任何后端进程。
const { app, BrowserWindow, ipcMain, shell, net, protocol, powerMonitor } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { createLicenseService } = require('./license.cjs')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jueying-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || null

let mainWindow = null
let licenseService = null

function dataFile() {
  return path.join(app.getPath('userData'), 'data.json')
}

function mediaDir() {
  return path.join(app.getPath('userData'), 'media')
}

function mediaUrl(id, ext = 'mp4') {
  return `jueying-media://local/${id}.${ext}`
}

function registerIpc() {
  ipcMain.handle('store:load', () => {
    try {
      return JSON.parse(fs.readFileSync(dataFile(), 'utf8'))
    } catch {
      return null
    }
  })

  ipcMain.handle('store:save', (_event, data) => {
    const file = dataFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return true
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('license:machine-id', async () => {
    const machine = await licenseService.machine()
    return { code: machine.code, display: machine.display }
  })

  ipcMain.handle('license:get-state', () => licenseService.ready())
  ipcMain.handle('license:checkin', () => licenseService.refresh({ manual: true }))
  ipcMain.handle('license:activate', (_event, code) => licenseService.activate(code))
  ipcMain.handle('license:reset', () => licenseService.reset())

  ipcMain.handle('media:save', async (_event, url, id, ext) => {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
    const cleanExt = /^[a-z0-9]{1,8}$/i.test(String(ext || '')) ? String(ext).toLowerCase() : 'mp4'
    if (!url || !safe) throw new Error('缺少视频地址或任务 ID')
    const dir = mediaDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${safe}.${cleanExt}`)
    if (fs.existsSync(file) && fs.statSync(file).size > 1024) return mediaUrl(safe, cleanExt)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10 * 60_000)
    try {
      const res = await net.fetch(String(url), { signal: controller.signal })
      if (!res.ok) throw new Error(`视频下载失败：${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (!buffer.length) throw new Error('视频下载内容为空')
      fs.writeFileSync(file, buffer)
      return mediaUrl(safe, cleanExt)
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle('media:saveBuffer', (_event, data, id, ext) => {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
    const cleanExt = /^[a-z0-9]{1,8}$/i.test(String(ext || '')) ? String(ext).toLowerCase() : 'bin'
    if (!safe) throw new Error('缺少素材 ID')
    const dir = mediaDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${safe}.${cleanExt}`)
    fs.writeFileSync(file, Buffer.from(new Uint8Array(data)))
    return mediaUrl(safe, cleanExt)
  })

  ipcMain.handle('media:delete', (_event, files) => {
    if (!Array.isArray(files)) return 0
    let removed = 0
    for (const raw of files) {
      const name = path.basename(String(raw || ''))
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) continue
      const file = path.join(mediaDir(), name)
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          removed += 1
        }
      } catch {
        // 文件被占用或已删除
      }
    }
    return removed
  })

  ipcMain.handle('media:reveal', async (_event, url) => {
    if (/^https?:/i.test(String(url || ''))) {
      await shell.openExternal(String(url))
      return true
    }
    const name = path.basename(decodeURIComponent(new URL(String(url)).pathname))
    const file = path.join(mediaDir(), name)
    if (!fs.existsSync(file)) throw new Error('本地文件不存在')
    shell.showItemInFolder(file)
    return true
  })

  ipcMain.handle('media:open', async (_event, url) => {
    if (/^https?:/i.test(String(url || ''))) {
      await shell.openExternal(String(url))
      return true
    }
    const name = path.basename(decodeURIComponent(new URL(String(url)).pathname))
    const file = path.join(mediaDir(), name)
    if (!fs.existsSync(file)) throw new Error('本地文件不存在')
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
    return true
  })

  ipcMain.handle('media:read', (_event, url) => {
    const name = path.basename(decodeURIComponent(new URL(String(url)).pathname))
    const file = path.join(mediaDir(), name)
    if (!fs.existsSync(file)) throw new Error('本地文件不存在')
    const buffer = fs.readFileSync(file)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  ipcMain.handle('app:dataPath', () => app.getPath('userData'))
}

function broadcastLicense(state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('license:update', state)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#ffffff',
    title: '掘影',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  protocol.handle('jueying-media', (request) => {
    try {
      const name = path.basename(decodeURIComponent(new URL(request.url).pathname))
      const file = path.join(mediaDir(), name)
      if (!fs.existsSync(file)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })

  licenseService = createLicenseService({
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    onUpdate: broadcastLicense,
  })

  registerIpc()
  licenseService.start()
  createWindow()

  powerMonitor.on('resume', () => {
    void licenseService?.poke()
  })
  powerMonitor.on('unlock-screen', () => {
    void licenseService?.poke()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  licenseService?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
