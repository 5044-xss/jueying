// 构建后端 sidecar：用 PyInstaller 打包 backend → 拷贝到 resources/backend/。
// Python 选择优先级：环境变量 PYTHON > backend/.venv > python(3)。
// 首次使用需准备环境：
//   cd backend && python -m venv .venv
//   .venv\Scripts\python -m pip install -r requirements.txt pyinstaller
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..')
const backendDir = path.resolve(frontendDir, '..', 'backend')
const isWin = process.platform === 'win32'

function pickPython() {
  if (process.env.PYTHON) return process.env.PYTHON
  const venv = isWin
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python')
  if (fs.existsSync(venv)) return venv
  return isWin ? 'python' : 'python3'
}

const py = pickPython()
console.log(`[build:backend] backend=${backendDir}`)
console.log(`[build:backend] python=${py}`)

const r = spawnSync(py, ['-m', 'PyInstaller', '--noconfirm', 'jueman-backend.spec'], {
  cwd: backendDir,
  stdio: 'inherit',
})
if (r.error || r.status !== 0) {
  console.error('[build:backend] PyInstaller 构建失败。首次使用请先准备 Python 环境：')
  console.error(`  cd ${backendDir}`)
  console.error('  python -m venv .venv')
  console.error(isWin
    ? '  .venv\\Scripts\\python -m pip install -r requirements.txt pyinstaller'
    : '  .venv/bin/python -m pip install -r requirements.txt pyinstaller')
  console.error('或设环境变量 PYTHON 指向已装好依赖的解释器。')
  process.exit(r.status ?? 1)
}

const exeName = isWin ? 'jueman-backend.exe' : 'jueman-backend'
const src = path.join(backendDir, 'dist', exeName)
if (!fs.existsSync(src)) {
  console.error(`[build:backend] 未找到产物：${src}`)
  process.exit(1)
}
const dstDir = path.join(frontendDir, 'resources', 'backend')
fs.mkdirSync(dstDir, { recursive: true })
const dst = path.join(dstDir, exeName)
try {
  fs.copyFileSync(src, dst)
} catch (e) {
  if (e.code === 'EBUSY' || e.code === 'EPERM') {
    console.error(`[build:backend] 无法写入 ${dst}：目标被占用。`)
    console.error('  请先退出正在运行的「掘影」/后端进程（taskkill /IM jueman-backend.exe /F），再重试。')
  } else {
    console.error(`[build:backend] 拷贝失败：${e.message}`)
  }
  process.exit(1)
}
console.log(`[build:backend] → ${dst}`)
