# jueying 桌面端（frontend）

jueying 视频生成工作台的桌面端（Electron + Vite + React + TypeScript）。
后端是 Python 服务 `jueying/backend`（FastAPI），本应用负责界面与生命周期管理。

- 架构与实施计划见 `../backend/DESKTOP-PLAN.md`
- 界面：暗色 + 渐变强调色（`#7c5cff → #22d3ee`），TailwindCSS + Framer Motion
- 数据：TanStack Query（接口缓存/轮询）+ zustand（UI/草稿态）
- 任务进度：SSE `GET /api/jobs/{id}/events`，断线自动回退到轮询

## 目录

```
electron/
  main.cjs      # 选端口、spawn 后端、探活、开窗、退出清理
  preload.cjs   # contextBridge 暴露 port / openPath / revealPath
src/
  api/          # types / client / queries（与后端契约）
  hooks/        # useJobEvents（SSE + 轮询回退）
  store/        # zustand：ui（视图/草稿）、toast
  components/   # AppShell / AssetUploader / PromptEditor / ParamsPanel / JobProgress / VideoPlayer / ModelSelect / ConnectionBadge + ui 基础件
  pages/        # Generator / Settings / History
resources/backend/  # 放 PyInstaller 产物 jueman-backend.exe（见其 README）
```

## 开发

需要本机有 Python 环境跑后端（`jue-man` 源码目录）。

```powershell
# 终端 A：后端
cd E:\ai\02_projects\jueying\backend
python run.py                      # 127.0.0.1:8642

# 终端 B：前端 + Electron
cd E:\ai\02_projects\jueying\frontend
npm install
npm run dev:electron               # vite(5173) + electron，自动加载 dev server
```

只想在浏览器里调 UI：`npm run dev`（`/api` 经 Vite proxy 到 `127.0.0.1:8642`）。

### 让 Electron 自己拉起源码后端（可选）

```powershell
$env:JUEMAN_SPAWN_BACKEND="1"
$env:JUEMAN_PYTHON="python"
$env:JUEMAN_BACKEND_DIR="E:\ai\02_projects\jueying\backend"
npm run dev:electron
```

## 打包

```powershell
# 1) 后端 exe（在 backend 目录）
pip install pyinstaller
pyinstaller jueman-backend.spec
copy dist\jueman-backend.exe ..\frontend\resources\backend\

# 2) 桌面端
cd E:\ai\02_projects\jueying\frontend
npm run build
npm run dist                       # electron-builder → release\（NSIS + portable）
```

主进程约定：

- 生产：后端为 `resources/backend/jueman-backend.exe`，注入 `JUEMAN_HOME=<userData>`、`JUEMAN_PORT=<动态端口>`。
- 端口：默认 8642，占用则自动向后找空闲端口，并经 preload 注入给前端。
- 数据（config.json / data/output / data/assets）落在 Electron `userData` 目录。
- 退出时 `taskkill /T /F` 兜底清理后端进程。

## 说明

- Electron 主进程/预加载用 `.cjs`（CommonJS），避免与 `"type": "module"` 冲突。
- 生产渲染页通过 `file://` 加载，所有接口使用绝对地址 `http://127.0.0.1:<port>`，不依赖相对路径。
- 首次使用：进入「设置」填仙宫云 `base_url` → 测试连接 → 保存；再到「生成台」上传图、写提示词、生成。
