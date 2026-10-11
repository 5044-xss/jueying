// 掘影 桌面主进程：选端口 → (可选)spawn 后端 → 探活 → 开窗 → 退出清理。
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const { spawn, execFile } = require('node:child_process')

const { getMachineCode } = require('./machine-id.cjs')
const { verifyLicense, loadLicense, saveLicense, clearLicense } = require('./license.cjs')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || null
// 开发态或显式 SKIP_LICENSE=1 时跳过激活门禁，方便调试。
const SKIP_LICENSE = process.env.SKIP_LICENSE === '1'
// 开发态也想联调激活流程时设 FORCE_LICENSE=1。
const FORCE_LICENSE = process.env.FORCE_LICENSE === '1'
// 检查更新的 GitHub 仓库（owner/repo）。
const REPO = '5044-xss/jueying'

let backendProc = null
let backendPort = 8642
let logStream = null
let mainWindow = null
let activationWindow = null
let appStarted = false

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

function licensePath() {
  return path.join(app.getPath('userData'), 'license.key')
}

// 应用窗口图标：开发取 public/，生产取 Vite 拷贝到 dist/ 的同名文件。
function appIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'app-icon.png'),
    path.join(__dirname, '..', 'dist', 'app-icon.png'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || undefined
}

// 后端数据目录（config.json / data）：
//   显式 JUEMAN_HOME 优先；开发态用 backend 项目目录（与源码运行一致）；生产用 userData。
function dataHome() {
  if (process.env.JUEMAN_HOME) return process.env.JUEMAN_HOME
  if (isDev) return path.join(__dirname, '..', '..', 'backend')
  return app.getPath('userData')
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

// 后端定位：
//   生产：process.resourcesPath/backend/jueman-backend.exe
//   开发：优先跑 backend/run.py 源码（改完后端即时生效，无需重打包 exe），
//         venv 优先；没有源码时回退到 frontend/resources/backend 里的预构建 exe。
// 设 JUEMAN_NO_BACKEND=1 可禁用（只调前端）。
function resolveBackend() {
  if (process.env.JUEMAN_NO_BACKEND === '1') return null

  // __dirname = <frontend>/electron，据此定位 frontend 目录与其同级的 backend。
  const frontendDir = path.join(__dirname, '..')
  const backendDir =
    process.env.JUEMAN_BACKEND_DIR || path.join(frontendDir, '..', 'backend')

  if (isDev) {
    const entry = path.join(backendDir, 'run.py')
    if (fs.existsSync(entry)) {
      const venvPy = path.join(backendDir, '.venv', 'Scripts', 'python.exe')
      const py =
        process.env.JUEMAN_PYTHON ||
        (fs.existsSync(venvPy) ? venvPy : 'python')
      return { cmd: py, args: [entry], cwd: backendDir }
    }
    const exe =
      process.env.JUEMAN_BACKEND_EXE ||
      path.join(frontendDir, 'resources', 'backend', 'jueman-backend.exe')
    if (fs.existsSync(exe)) return { cmd: exe, args: [], cwd: path.dirname(exe) }
    return null
  }

  const exe = path.join(process.resourcesPath, 'backend', 'jueman-backend.exe')
  if (fs.existsSync(exe)) return { cmd: exe, args: [], cwd: path.dirname(exe) }
  return null
}

function startBackend(spec, port) {
  const home = dataHome()
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
          message: `掘影 后端进程意外退出（code=${code}）。`,
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
    title: '掘影',
    icon: appIconPath(),
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
  dataHome: dataHome(),
  version: app.getVersion(),
  platform: process.platform,
}))

// —— 激活/授权 IPC ——
ipcMain.handle('license:machine-id', async () => {
  const { code, display } = await getMachineCode()
  return { code, display }
})

ipcMain.handle('license:activate', async (_e, licenseCode) => {
  const { code } = await getMachineCode()
  const result = verifyLicense(licenseCode, code)
  if (!result.ok) return { ok: false, error: result.error }
  saveLicense(licensePath(), licenseCode)
  setTimeout(() => {
    if (activationWindow && !activationWindow.isDestroyed()) activationWindow.close()
    startApp()
  }, 400)
  return { ok: true }
})

ipcMain.handle('license:reset', () => {
  clearLicense(licensePath())
  killBackend()
  // 先创建激活窗，再关主窗：保证任何时刻都有窗口，避免触发 window-all-closed 退出。
  showActivation()
  if (mainWindow && !mainWindow.isDestroyed()) {
    const w = mainWindow
    mainWindow = null
    w.close()
  }
  return { ok: true }
})

// —— 更新检查（读取 GitHub Releases 最新 tag）——
ipcMain.handle('update:check', async () => {
  const current = app.getVersion()
  const canUpdate = app.isPackaged
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'User-Agent': 'Jueying-Desktop',
        Accept: 'application/vnd.github+json',
      },
    })
    // 404：仓库尚无任何 Release，视为「暂无更新」。
    if (res.status === 404) {
      return { ok: true, current, latest: current, url: null, hasUpdate: false, canUpdate, note: '暂无发布版本' }
    }
    // 403/429：GitHub 未授权接口限流，属临时状况。
    if (res.status === 403 || res.status === 429) {
      return { ok: false, canUpdate, error: '检查太频繁了，请稍后再试' }
    }
    if (!res.ok) return { ok: false, canUpdate, error: `检查更新失败（HTTP ${res.status}）` }
    const data = await res.json()
    const latest = String(data.tag_name || '').replace(/^v/i, '')
    return {
      ok: true,
      current,
      latest,
      url: data.html_url,
      hasUpdate: compareVersions(latest, current) > 0,
      canUpdate,
    }
  } catch {
    return { ok: false, canUpdate, error: '网络异常，请稍后再试' }
  }
})

// —— 自动更新（electron-updater）：点击「立即更新」→ 下载 → 自动重启安装 ——
let updaterReady = false

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', payload)
  }
}

function ensureUpdater() {
  if (updaterReady) return
  updaterReady = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: '5044-xss', repo: 'jueying' })
  } catch (e) {
    log(`setFeedURL failed: ${e.message}`)
  }
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    sendUpdateStatus({ phase: 'available', version: info && info.version }),
  )
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ phase: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    sendUpdateStatus({ phase: 'downloading', percent: Math.round((p && p.percent) || 0) }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ phase: 'downloaded', version: info && info.version })
    // 留一点时间让界面提示，然后自动退出并安装新版本
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (e) {
        log(`quitAndInstall failed: ${e.message}`)
      }
    }, 1200)
  })
  autoUpdater.on('error', (err) =>
    sendUpdateStatus({ phase: 'error', message: String((err && err.message) || err) }),
  )
}

async function startUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式不支持自动更新，请在安装版中使用' }
  }
  try {
    ensureUpdater()
    await autoUpdater.checkForUpdates()
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    const msg = String((e && e.message) || e)
    sendUpdateStatus({ phase: 'error', message: msg })
    return { ok: false, error: msg }
  }
}

ipcMain.handle('update:start', () => startUpdate())

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

// 启动主界面：选端口 → 拉起后端 → 开窗。
async function startApp() {
  if (appStarted) return
  appStarted = true

  const envPort = process.env.JUEMAN_PORT ? parseInt(process.env.JUEMAN_PORT, 10) : null
  const preferred = envPort || 8642

  // 已有后端在跑（例如你手动起的源码后端）→ 直接复用，不重复 spawn。
  if (await pingHealth(preferred)) {
    backendPort = preferred
    log(`reusing existing backend on http://127.0.0.1:${backendPort}`)
    createWindow(backendPort)
    return
  }

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
        message: '等待 掘影 后端超时（30s），界面仍会打开但可能不可用。',
        detail: logPath() ? `日志：${logPath()}` : undefined,
      })
    } else {
      log('backend healthy')
    }
  } else {
    log(
      'no backend to spawn — 请确认 frontend/resources/backend/jueman-backend.exe 存在，' +
        '或用 JUEMAN_BACKEND_DIR 指向 backend 源码（需本机 Python），或设 JUEMAN_NO_BACKEND=1 自行启动。',
    )
  }

  createWindow(backendPort)
}

// 激活窗（未激活时只显示它，不启动后端/主界面）。
function showActivation() {
  if (activationWindow && !activationWindow.isDestroyed()) {
    activationWindow.focus()
    return
  }
  activationWindow = new BrowserWindow({
    width: 520,
    height: 470,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: '#0b0e14',
    title: '掘影 · 激活',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  activationWindow.once('ready-to-show', () => activationWindow.show())
  activationWindow.on('closed', () => {
    activationWindow = null
  })
  activationWindow.loadFile(path.join(__dirname, 'activation.html'))
}

// 启动门禁：开发态/显式跳过 → 直接进主界面；否则校验已保存激活码，未通过则显示激活窗。
async function bootstrap() {
  if ((isDev && !FORCE_LICENSE) || SKIP_LICENSE) {
    log('license gate skipped (dev/skip)')
    await startApp()
    return
  }
  const { code } = await getMachineCode()
  const saved = loadLicense(licensePath())
  if (saved) {
    const result = verifyLicense(saved, code)
    if (result.ok) {
      log('license ok')
      await startApp()
      return
    }
    log(`license invalid: ${result.error}`)
    clearLicense(licensePath())
  }
  log('not activated — showing activation window')
  showActivation()
}

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (appStarted) createWindow(backendPort)
      else showActivation()
    }
  })

  app.whenReady().then(bootstrap)

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
