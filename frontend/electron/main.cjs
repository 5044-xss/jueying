// jue-man 桌面主进程：选端口 → (可选)spawn 后端 → 探活 → 开窗 → 退出清理。
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const { spawn, execFile } = require('node:child_process')

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || null

let backendProc = null
let backendPort = 8642
let logStream = null
let mainWindow = null

function logPath() {
  try {
    return path.join(app.getPath('userData'), 'backend.log')
  } catch {
    return null
  }
}

function log(...args) {
  const line = `[jueman-main] ${args.join(' ')}\n`
  process.stdout.write(line)
  try {
    if (logStream) logStream.write(line)
  } catch {
    /* ignore */
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function pickPort(preferred) {
  const start = Number(preferred) || 8642
  if (await isPortFree(start)) return start
  for (let p = start + 1; p < start + 60; p++) {
    if (await isPortFree(p)) return p
  }
  return start
}

function pingHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitHealthy(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pingHealth(port)) return true
    await sleep(400)
  }
  return false
}

// 生产：resources/backend/jueman-backend.exe；开发：可选 spawn 源码后端。
function resolveBackend() {
  if (isDev) {
    if (process.env.JUEMAN_SPAWN_BACKEND !== '1') return null
    const dir =
      process.env.JUEMAN_BACKEND_DIR ||
      path.join(app.getAppPath(), '..', 'backend')
    const py = process.env.JUEMAN_PYTHON || 'python'
    return { cmd: py, args: [path.join(dir, 'run.py')], cwd: dir }
  }
  const exe = path.join(process.resourcesPath, 'backend', 'jueman-backend.exe')
  if (fs.existsSync(exe)) return { cmd: exe, args: [], cwd: path.dirname(exe) }
  return null
}

function startBackend(spec, port) {
  const home = app.getPath('userData')
  fs.mkdirSync(home, { recursive: true })
  const lp = logPath()
  if (lp) {
    try {
      logStream = fs.createWriteStream(lp, { flags: 'a' })
    } catch {
      logStream = null
    }
  }
  log(`spawn backend: ${spec.cmd} ${spec.args.join(' ')} (port=${port}, home=${home})`)
  backendProc = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      JUEMAN_HOME: home,
      JUEMAN_PORT: String(port),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    windowsHide: true,
  })
  backendProc.stdout.on('data', (d) => {
    const s = d.toString()
    process.stdout.write(s)
    if (logStream) logStream.write(s)
  })
  backendProc.stderr.on('data', (d) => {
    const s = d.toString()
    process.stderr.write(s)
    if (logStream) logStream.write(s)
  })
  backendProc.on('error', (err) => {
    log(`backend spawn error: ${err.message}`)
  })
  backendProc.on('exit', (code, signal) => {
    log(`backend exited code=${code} signal=${signal}`)
    if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
      // 非正常退出才提示
      if (code !== 0 && code !== null) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '后端服务已退出',
          message: `jue-man 后端进程意外退出（code=${code}）。`,
          detail: lp ? `日志：${lp}` : undefined,
        })
      }
    }
  })
}

function killBackend() {
  if (!backendProc || backendProc.killed) return
  const pid = backendProc.pid
  log(`kill backend pid=${pid}`)
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
    } else {
      backendProc.kill('SIGTERM')
    }
  } catch (e) {
    log(`kill failed: ${e.message}`)
  }
  backendProc = null
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0b0e14',
    show: false,
    title: 'jue-man',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--jueman-port=${port}`],
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('jueman:open-path', async (_e, p) => {
  if (!p) return 'empty path'
  return shell.openPath(p)
})

ipcMain.handle('jueman:reveal-path', async (_e, p) => {
  if (!p) return
  try {
    if (fs.existsSync(p)) shell.showItemInFolder(p)
    else {
      const dir = path.dirname(p)
      if (fs.existsSync(dir)) shell.openPath(dir)
    }
  } catch {
    /* ignore */
  }
})

ipcMain.handle('jueman:open-external', async (_e, url) => {
  if (url) await shell.openExternal(url)
})

ipcMain.handle('jueman:info', () => ({
  port: backendPort,
  isDev,
  userData: app.getPath('userData'),
  version: app.getVersion(),
  platform: process.platform,
}))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const envPort = process.env.JUEMAN_PORT
      ? parseInt(process.env.JUEMAN_PORT, 10)
      : null
    backendPort = envPort || (await pickPort(8642))
    log(`selected port=${backendPort} isDev=${isDev}`)

    const spec = resolveBackend()
    if (spec) {
      startBackend(spec, backendPort)
      const ok = await waitHealthy(backendPort, 30000)
      if (!ok) {
        log('backend health check timed out')
        dialog.showMessageBox({
          type: 'warning',
          title: '后端未就绪',
          message: '等待 jue-man 后端超时（30s），界面仍会打开但可能不可用。',
          detail: logPath() ? `日志：${logPath()}` : undefined,
        })
      } else {
        log('backend healthy')
      }
    } else {
      log('no backend to spawn (dev external mode) — expecting manual `python run.py`')
    }

    createWindow(backendPort)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(backendPort)
    })
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    killBackend()
  })
  app.on('will-quit', killBackend)
  app.on('window-all-closed', () => {
    killBackend()
    if (process.platform !== 'darwin') app.quit()
  })
  process.on('exit', killBackend)
}
