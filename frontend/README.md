# 掘影 桌面端（frontend）

掘影 视频生成工作台的桌面端（Electron + Vite + React + TypeScript）。
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

`npm run dev:electron` 会**同时拉起前后端**：Vite(5173) + Electron，Electron 主进程再自动启动后端。

后端来源优先级（开发态）：

1. `resources/backend/jueman-backend.exe`（已构建的 sidecar，**无需本机 Python**）；
2. 否则回退用 Python 跑 `../backend/run.py`（需本机 Python 环境）。

```powershell
cd E:\ai\02_projects\jueying\frontend
npm install
npm run dev:electron               # vite + electron + 自动拉起后端
```

只想在浏览器里调 UI：`npm run dev`（`/api` 经 Vite proxy 到 `127.0.0.1:8642`，此时需自行启动后端）。

### 覆盖后端启动方式（可选）

```powershell
# 指定后端 exe
$env:JUEMAN_BACKEND_EXE="E:\path\to\jueman-backend.exe"

# 用 Python 源码跑后端
$env:JUEMAN_BACKEND_DIR="E:\ai\02_projects\jueying\backend"
$env:JUEMAN_PYTHON="python"

# 完全不自动启动后端（只调前端）
$env:JUEMAN_NO_BACKEND="1"

npm run dev:electron
```

## 激活授权（离线签名，一码一机）

打包版启动时校验 `userData\license.key`：未通过只显示**激活窗**（不启动后端/主界面）。
开发态默认跳过（设 `FORCE_LICENSE=1` 可在开发态联调激活流程，`SKIP_LICENSE=1` 强制跳过）。

机制：Ed25519 非对称签名，无需服务器。
激活码 = `base64url({mid,v,issuedAt}) + "." + base64url(签名)`，`mid` 为本机机器码。

```powershell
# 1) 生成密钥对（只做一次；私钥写入 keys/，绝不入库/分发）
npm run gen-keypair

# 2) 用户把「设置 → 授权与版本」里的机器码发给你，用它签发激活码
npm run sign-license -- 67D2-77CC-199C-A56E      # 或直接运行后按提示粘贴
```

- 公钥内嵌在 `electron/license-public.cjs`（入库）；私钥 `keys/license-private.pem`（**务必自行备份，勿提交/随包分发**）。
- 换硬件机器码变化 → 需重新签发；删除 `keys/` 重新签发会使**所有旧激活码失效**。
- 用户侧：`设置 → 授权与版本` 可查看/复制机器码，或「重新激活」清除本地授权回到激活窗。

## 更新检查（手动）

「设置 → 授权与版本 → 检查更新」读取 GitHub Releases 最新 tag，与当前版本比较：

- 有新版 → 显示版本号 +「前往下载 vX.Y.Z」（用系统浏览器打开 Release 页，不自动下载安装）。
- 无 Release / 已最新 → 提示；接口限流（403/429）→ 友好提示。

仓库常量在主进程 `electron/main.cjs` 的 `REPO = "5044-xss/jueying"`。发版时打 `vX.Y.Z` tag 并发布 Release 即可被检测到。

## 打包与发版

首次准备后端 Python 环境：

```powershell
cd E:\ai\02_projects\jueying\backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt pyinstaller
```

```powershell
cd E:\ai\02_projects\jueying\frontend
npm run build:backend             # 只重建后端 exe → resources/backend/
npm run package                   # 一键：后端 exe + 前端 + 安装包（release\：NSIS + portable）
npm run package:dir               # 只出免安装目录（调试用）

npm run release                   # 发版：构建 + 打 tag + 推送 + 创建 GitHub Release
npm run release -- --bump patch   # 先升 patch 版本再发版（major|minor|patch 或 x.y.z）
npm run release -- --notes "本版更新：…"
```

- `release` 需先 `gh auth login`；产物上传到 `5044-xss/jueying` 的 Releases，应用内「检查更新」即可看到。

主进程约定：

- 生产：后端为 `resources/backend/jueman-backend.exe`，注入 `JUEMAN_HOME=<userData>`、`JUEMAN_PORT=<动态端口>`。
- 端口：默认 8642，占用则自动向后找空闲端口，并经 preload 注入给前端。
- **数据目录**：开发态用 `backend/`（与源码运行一致，`config.json`/`data` 都在这里）；生产态用 Electron `userData`。可用环境变量 `JUEMAN_HOME` 覆盖。
- **复用**：若 `127.0.0.1:8642` 已有后端在跑（例如你手动起的源码后端），直接复用，不再重复启动。
- **历史持久化**：后端把任务列表落盘到 `HOME/data/jobs.json`，重启后历史页仍可见；上次未完成的任务会被标记为「应用重启，任务中断」。
- 退出时 `taskkill /T /F` 兜底清理后端进程。
- 激活门禁：`app.isPackaged` 为真时才启用；打包 `files` 已含 `electron/**`（含 `license.cjs`/`machine-id.cjs`/`activation.html`）。

## 说明

- Electron 主进程/预加载用 `.cjs`（CommonJS），避免与 `"type": "module"` 冲突。
- 生产渲染页通过 `file://` 加载，所有接口使用绝对地址 `http://127.0.0.1:<port>`，不依赖相对路径。
- 首次使用：进入「设置」填仙宫云 `base_url` → 测试连接 → 保存；再到「生成台」上传图、写提示词、生成。
