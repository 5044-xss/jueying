// 掘影 桌面主进程：只做窗口与本地存储，不再启动任何后端进程。
const { app, BrowserWindow, ipcMain, shell, net, protocol, powerMonitor } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Readable } = require('node:stream')
const { createLicenseService } = require('./license.cjs')

const MIME_BY_EXT = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function mimeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function looksLikeMediaFile(file) {
  try {
    const info = fs.statSync(file)
    if (!info.isFile() || info.size < 1024) return false
    const ext = path.extname(file).slice(1).toLowerCase()
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(16)
    try {
      fs.readSync(fd, head, 0, 16, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (ext === 'webm' || ext === 'mkv') {
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
    }
    if ((ext === 'mp4' || ext === 'm4v' || ext === 'mov') && head.toString('latin1', 0, 16).includes('ftyp')) {
      return true
    }
    // 排除被保存成 .mp4 的 HTML/JSON/纯文本错误页
    const printable = (b) => b >= 0x20 && b < 0x7f
    if (head.subarray(0, 4).every(printable)) return false
    const first = head.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09)
    return first !== undefined && first !== 0x3c && first !== 0x7b && first !== 0x5b
  } catch {
    return false
  }
}

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
    if (looksLikeMediaFile(file)) return mediaUrl(safe, cleanExt)

    let lastError = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10 * 60_000)
      try {
        const res = await net.fetch(String(url), { signal: controller.signal })
        if (!res.ok) throw new Error(`视频下载失败：${res.status}`)
        const expected = Number(res.headers.get('content-length') || 0)
        const buffer = Buffer.from(await res.arrayBuffer())
        if (!buffer.length) throw new Error('视频下载内容为空')
        if (expected > 0 && buffer.length !== expected) {
          throw new Error(`视频下载不完整（${buffer.length}/${expected} 字节）`)
        }
        const tmp = `${file}.${process.pid}.${Date.now()}.part`
        fs.writeFileSync(tmp, buffer)
        fs.renameSync(tmp, file)
        if (!looksLikeMediaFile(file)) {
          fs.rmSync(file, { force: true })
          throw new Error('下载的成片不是有效视频')
        }
        return mediaUrl(safe, cleanExt)
      } catch (err) {
        lastError = err
        fs.rmSync(file, { force: true })
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('视频下载失败')
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
      const stat = fs.statSync(file)
      const type = mimeOf(file)
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Type': type,
            'Content-Length': String(stat.size),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          },
        })
      }
      const range = request.headers.get('range')
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
        if (match) {
          const from = match[1]
          const to = match[2]
          let start = from ? Number(from) : 0
          let end = to ? Number(to) : stat.size - 1
          if (!from && to) {
            const suffix = Number(to)
            start = Math.max(0, stat.size - suffix)
            end = stat.size - 1
          }
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }
          end = Math.min(end, stat.size - 1)
          return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
            status: 206,
            headers: {
              'Content-Type': type,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }
      return new Response(Readable.toWeb(fs.createReadStream(file)), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      })
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
