# jue-man 桌面端（jue-man-desktop）实施计划

> 目标：把已完成的 Python 视频生成服务 `jue-man` 作为后端引擎，配一个自研 React 前端，
> 打包成 Windows 桌面应用（Electron）。
> 本文档自包含，新会话可直接照此执行。

---

## 0. 背景与现状（新会话必读）

**已有后端**：`E:\appData\h3-app\jue-man\`（Python FastAPI，已跑通）
- 引擎复用自老项目：`engine/cloud_http.py`（ComfyUI 客户端）、`engine/workflows.py`（组工作流图，**明文模型名，无 keyguard/无授权**）。
- 启动：`python run.py`（默认 `127.0.0.1:8642`）。
- 已有自测页（可选保留）：`GET /`。
- 生成链路：上传素材 → 组工作流 → `POST /prompt` → 轮询 `/history` → 下载 `/view`。
- 只支持 **仙宫云 xgpu URL 直连** 与 **AutoDL SSH**；**不做 autodl_api 托管**（已确认）。

**现有 HTTP 接口（前端只需认这些）**：
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ok, version, configured}` |
| GET/PUT | `/api/settings` | 读写配置（深合并） |
| POST | `/api/cloud/test` | `{cloud:{...}}` → `{ok, detail, catalog}` |
| GET | `/api/cloud/catalog` | 实例已装节点 + 可用 unet/lora/clip/vae 列表 |
| POST | `/api/assets` | multipart：`file` + `kind=image|audio` → `{id,name,kind,size}` |
| GET | `/api/assets` | 素材列表 |
| GET | `/api/assets/{id}` | 取素材文件 |
| POST | `/api/jobs` | 创建任务，body 见下 |
| GET | `/api/jobs` | 任务列表 |
| GET | `/api/jobs/{id}` | 单任务状态/进度/`videoUrl` |
| GET | `/api/jobs/{id}/events` | **SSE** 实时状态（结束发 `event: done`） |
| POST | `/api/jobs/{id}/cancel` | 取消 |
| GET | `/api/jobs/{id}/video` | 成片（可直接 `<video src>`） |

`POST /api/jobs` body：
```json
{
  "prompt": "…@图片1 走向…@图片2…",
  "title": "clip-1",
  "duration": 8, "aspect": "16:9", "resolution": "0.5", "seed": 0,
  "images": ["assetId…"], "audios": ["assetId…"],
  "firstFrame": "assetId|null", "lastFrame": "assetId|null",
  "samplerMode": "legacy|new|null", "modelVariant": "auto|fl2va|ref2va"
}
```
约定：参考图顺序 = `images → firstFrame → lastFrame`，对应 `<Picture 1..N>`；
prompt 里 `@图片N / @图N / @N` 后端会自动转成 `<Picture N>`。

---

## 1. 技术栈

- 桌面壳：**Electron + electron-builder**
- 前端：**Vite + React + TypeScript**
- 样式：**TailwindCSS + shadcn/ui**（Radix），动画 **Framer Motion**
- 状态/数据：**zustand**（UI 态）+ **TanStack Query**（接口缓存/轮询）
- 表单：**react-hook-form + zod**
- 后端：**PyInstaller** 把 `jue-man` 打成 `jueman-backend.exe` 作为 sidecar

不用 Next.js（桌面端不需要 SSR/静态导出，Vite SPA 更简单）。

---

## 2. 架构

```
┌──────────────── Electron 桌面应用 ─────────────────┐
│ Renderer(React) ── fetch/SSE ─▶ http://127.0.0.1:<port>/api
│                                                    │
│ Main(Node) ── spawn ─▶ [ jueman-backend.exe ]      │
│   · 选空闲端口，注入 env(JUEMAN_HOME/JUEMAN_PORT)   │
│   · 轮询 /api/health 探活后开窗                      │
│   · app 退出时 kill 子进程                          │
└────────────────────────────────────────────────────┘
```

- 后端只绑 `127.0.0.1`；CORS 已放开。
- 数据（config.json / output / assets）落在 Electron `userData` 目录。

---

## 3. 目录结构

```
E:\appData\h3-app\jue-man-desktop\
  electron\
    main.ts            # spawn 后端、探活、开窗、退出清理
    preload.ts         # contextBridge（暴露 backendPort / 打开目录等）
  src\                 # React 前端
    api\client.ts      # fetch 封装
    api\queries.ts     # TanStack Query hooks
    api\types.ts       # 与后端契约的类型
    hooks\useJobEvents.ts   # SSE
    store\ui.ts        # zustand
    pages\Generator.tsx
    pages\Settings.tsx
    pages\History.tsx
    components\…       # AssetUploader / PromptEditor / ParamsPanel / JobProgress / VideoPlayer / ConnectionBadge
    App.tsx  main.tsx  index.css
  resources\backend\jueman-backend.exe   # PyInstaller 产物
  package.json         # electron-builder 配置
  vite.config.ts
  tailwind.config.js
  tsconfig.json
```

---

## 4. 第一步：给 jue-man 后端做「桌面适配」（必须先做）

改 `E:\appData\h3-app\jue-man\`，让它从环境变量取路径/端口，而不是死读项目目录。

### 4.1 `jueman/config.py`
- 新增：
  ```python
  HOME = os.environ.get("JUEMAN_HOME") or ROOT
  CONFIG_PATH = os.path.join(HOME, "config.json")
  ```
- `run_dir(rel)` 改为基于 `HOME`：`os.path.join(HOME, rel)`。
- 默认 `output_dir="data/output"`、`asset_dir="data/assets"` 保持相对，由 `run_dir` 落到 `HOME` 下。

### 4.2 `run.py`
- 端口优先级：`--port` 参数 > 环境变量 `JUEMAN_PORT` > `config.server.port` > 8642。
- 固定 `host="127.0.0.1"`。
- 增加 `--host`（可选，便于局域网调试）。
- 启动后打印一行 `JUEMAN_READY http://127.0.0.1:<port>`（Electron 可据此探活，比轮询更快）。

### 4.3 打包（PyInstaller）
新建 `E:\appData\h3-app\jue-man\jueman-backend.spec`：
- onefile，name=`jueman-backend`，`console=False`（release）；调试版可 `console=True`。
- `datas`: `("jueman/static", "jueman/static")`。
- `hiddenimports`: `uvicorn.logging, uvicorn.loops.auto, uvicorn.protocols.http.auto,
  uvicorn.protocols.websockets.auto, uvicorn.lifespan.on, fastapi, starlette,
  multipart, email.mime.multipart`（urllib3 可选）。
- 构建：
  ```powershell
  cd E:\appData\h3-app\jue-man
  pip install pyinstaller
  pyinstaller jueman-backend.spec
  # 产物 dist\jueman-backend.exe → 拷到 jue-man-desktop\resources\backend\
  ```

> 验证：拷到临时目录并用 `JUEMAN_HOME` 指向另一目录运行，确认能起、`/api/health` 通、`/` 自测页打开。

---

## 5. Electron 主进程（electron\main.ts）

职责：
1. 选端口：默认 8642；被占用则找空闲端口（Node `net` 探测）。
2. 解析后端路径：
   - 生产：`path.join(process.resourcesPath, 'backend', 'jueman-backend.exe')`
   - 开发：系统 `python` + `E:\appData\h3-app\jue-man\run.py`（用 `JUEMAN_DEV=1` 判断）。
3. `spawn` 时注入 env：
   ```
   JUEMAN_HOME = app.getPath('userData')
   JUEMAN_PORT = <port>
   ```
4. 探活：读 stdout 的 `JUEMAN_READY` 或轮询 `GET /api/health`（超时 30s）。
5. `BrowserWindow`：`contextIsolation:true, nodeIntegration:false`，加载：
   - dev：`http://localhost:5173`
   - 生产：`file://…/dist/index.html`
6. 退出清理：`will-quit` / `before-quit` kill 子进程（Windows 用 `taskkill /pid /T /F` 兜底）。
7. 后端异常退出：弹错误框 + 记录日志（`userData\backend.log`）。

preload 暴露：
```ts
contextBridge.exposeInMainWorld('jueman', {
  port: backendPort,                 // 前端据此拼 baseURL
  openPath: (p) => ipcRenderer.invoke('open-path', p),
});
```
> 前端 baseURL：开发用 Vite proxy（`/api → http://127.0.0.1:8642`）；生产用 `http://127.0.0.1:${port}`。
> 简单起见也可全程用 `http://127.0.0.1:<port>`，preload 提供 port。

---

## 6. 前端功能划分

### 6.1 页面
- **生成台 Generator**
  - 顶部：连接状态徽章（`/api/health` 的 configured + 最近一次 test 结果）、当前集群名。
  - 素材区：拖拽上传图/音；缩略图带序号（= `<Picture N>`）；可拖拽排序、删除；首/尾帧用下拉从已传图里选。
  - 参数区：时长(4–15)、画幅、清晰度(MP)、种子、模型路由(auto/fl2va/ref2va)。
  - 提示词：文本域 + 图片 chips，点击插入 `@图片N`；支持光标处插入。
  - 生成 → 结果区：SSE 进度条 + 状态文字 + 完成后内嵌播放器 + 「打开文件所在目录」。
- **设置 Settings**
  - 连接：类型(xgpu/autodl)、base_url 或 SSH 字段、模型前缀/LoRA 前缀、采样链路(自动/legacy/new)。
  - 按钮：测试连接（显示节点数/是否有 XB 分辨率节点/SaveVideo + 可用 unet/clip 下拉）。
  - 生成默认值：默认时长/画幅/清晰度；模型文件名覆盖（models 字典，下拉来自 catalog）。
  - 保存走 `PUT /api/settings`；密钥输入框 `type=password`。
- **历史 History**
  - `GET /api/jobs` 列表：状态、时长、时间、缩略/播放、取消、重跑（用同样的参数再 `POST /api/jobs`）。

### 6.2 组件
`AssetUploader`、`PromptEditor`(mention)、`ParamsPanel`、`JobProgress`(SSE)、`VideoPlayer`、
`ConnectionBadge`、`ModelSelect`(catalog)、`ConfirmDialog`。

### 6.3 数据流
- TanStack Query 管 settings/assets/jobs 列表。
- `useJobEvents(jobId)` 用 `EventSource('/api/jobs/'+id+'/events')`，`done` 后拉一次 `GET /api/jobs/{id}` 拿 `videoUrl`。
- zustand 管：当前 jobId、已选素材顺序、首尾帧选择、表单草稿。

### 6.4 UI 质感（对标 libtv）
- 暗色 + 渐变强调色（`#7c5cff → #22d3ee`），圆角卡片，柔和阴影。
- shadcn/ui 的 Dialog/Popover/Slider/Toast/Tabs/Tooltip；Framer Motion 做进入/进度动画。
- 播放器用 `<video>` 自绘控件或 `react-player`。
- 参考 `jue-man\jueman\static\index.html` 的配色与布局（自测页），把它升级成组件化界面。

---

## 7. 开发流程

```powershell
# 终端 A：后端
cd E:\appData\h3-app\jue-man
python run.py                      # 127.0.0.1:8642

# 终端 B：前端 + Electron
cd E:\appData\h3-app\jue-man-desktop
npm install
npm run dev                        # vite（5173）+ electron（加载 dev server）
```
`vite.config.ts` 配 proxy：
```ts
server: { proxy: { '/api': 'http://127.0.0.1:8642' } }
```

---

## 8. 打包流程

```powershell
# 1) 后端 exe（见第 4 节）→ resources\backend\jueman-backend.exe

# 2) 前端构建 + Electron 打包
cd E:\appData\h3-app\jue-man-desktop
npm run build                      # vite build → dist\
npx electron-builder               # 出 NSIS 安装包 / 免安装 exe
```
electron-builder `package.json` 关键项：
```json
"build": {
  "appId": "com.jueman.app",
  "productName": "jue-man",
  "files": ["dist/**", "electron/**", "package.json"],
  "extraResources": [
    { "from": "resources/backend/jueman-backend.exe", "to": "backend/jueman-backend.exe" }
  ],
  "win": { "target": ["nsis", "portable"] }
}
```

---

## 9. 里程碑 / 任务清单（按顺序）

- **M0 后端适配**（✅ 已基本完成）
  1. ✅ `config.py` 支持 `JUEMAN_HOME`（默认：打包=exe 目录 / 源码=项目目录）。
  2. ✅ `run.py` 支持 `JUEMAN_PORT` / `--port` / `--host`，启动打印 `JUEMAN_READY http://host:port`。
  3. ✅ `jueman-backend.spec` 已写；⚠️ **尚未实际执行 PyInstaller 出 exe**（本机未装 pyinstaller）。
     构建命令见第 4.3 节。
- **M1 Electron 骨架**（✅ 完成）
  4. ✅ 建 `jue-man-desktop`（Vite+React+TS+Tailwind，手写 shadcn 风格基础件）。
  5. ✅ `electron/main.cjs`：spawn 后端 + 探活 + 开窗 + 退出清理；dev/prod 路径分支（动态选端口）。
  6. ✅ `electron/preload.cjs` 暴露 port / openPath / revealPath / info。
  7. ✅ 跑通：Electron 启动后窗口能调 `/api/health`（已实测拉起窗口、选端口、无渲染错误）。
- **M2 设置页**（✅ 完成）
  8. ✅ 连接表单 + 测试连接（展示 catalog）+ 保存（zod 校验 + 密码框）。
  9. ✅ 生成默认值 & 模型文件名覆盖（下拉来自 catalog）。
- **M3 生成台**（✅ 完成）
  10. ✅ 素材上传/排序/删除、首尾帧选择。
  11. ✅ 参数面板 + 提示词 @mention（光标处插入）。
  12. ✅ 提交 + SSE 进度 + 播放器 + 打开成片目录。
- **M4 历史页**（✅ 完成）
  13. ✅ 列表 + 取消 + 重跑（沿用生成台素材）+ 载入草稿。
- **M5 打磨与打包**（部分）
  14. ✅ UI 精修（暗色渐变 / 卡片 / 动画）、空态/错误态/加载态、Toast。
  15. ⏳ electron-builder 已配置（NSIS+portable）；**待后端 exe 产出后** `npm run dist` 实测。
  16. ✅ 首次运行引导（未配置时生成台顶部提示进设置页）。

> 实际落地路径（monorepo）：`E:\ai\02_projects\jueying\frontend`（桌面端）+ `E:\ai\02_projects\jueying\backend`（Python 后端）。
> Electron 主进程/预加载改用 `.cjs`（避免与 package.json 的 `"type": "module"` 冲突）。


---

## 10. 注意事项 / 已知坑

- **必须走 `http://127.0.0.1`**，不能 `file://` 打开页面（相对 `/api` 会 Failed to fetch）。
- 后端绑 `127.0.0.1`，桌面本地访问安全；不要暴露公网。
- **地址容错**：后端已自动补 `https://` 前缀、去空格/尾斜杠。
- **首次生成**建议最省参数：1 图 + 5~8s + 0.5 MP + 16:9，先确认能出片。
- 仙宫云默认：采样链路=自动(→legacy)、模型前缀=`MiniMax-H3`。
- **PyInstaller**：onefile 首次启动解压较慢；Windows Defender 可能误报，必要时签名。
- **端口占用**：主进程动态选端口并注入，前端用 preload 给的 port。
- **进程清理**：务必在退出时 kill 后端，避免残留占用端口。
- **SSE 断线**：前端要做 EventSource `onerror` 回退到轮询 `GET /api/jobs/{id}`。
- **密钥**：settings 里 SSH 密码/token 输入用密码框；如需展示可做掩码。
- 打包体积：Electron ~150MB+；后端 exe（含依赖）几十 MB。

---

## 11. 需要产出的接口封装参考（前端）

```ts
// src/api/types.ts
export type JobState = 'running'|'queued'|'success'|'error'|'cancelled';
export interface Job { id:string; state:JobState; message:string; progress:{bytes:number;total:number};
  name:string; promptId:string; error:string; videoUrl:string; params:any; }

// src/api/client.ts（baseURL 由 preload 的 port 决定）
const base = `http://127.0.0.1:${window.jueman?.port ?? 8642}`;
export const api = {
  health: () => fetch(`${base}/api/health`).then(r=>r.json()),
  settings: () => fetch(`${base}/api/settings`).then(r=>r.json()),
  saveSettings: (p:any) => fetch(`${base}/api/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()),
  testCloud: (cloud:any) => fetch(`${base}/api/cloud/test`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cloud})}).then(r=>r.json()),
  catalog: () => fetch(`${base}/api/cloud/catalog`).then(r=>r.json()),
  upload: (file:File, kind:'image'|'audio') => { const fd=new FormData(); fd.append('file',file); fd.append('kind',kind); return fetch(`${base}/api/assets`,{method:'POST',body:fd}).then(r=>r.json()); },
  createJob: (body:any) => fetch(`${base}/api/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()),
  jobs: () => fetch(`${base}/api/jobs`).then(r=>r.json()),
  job: (id:string) => fetch(`${base}/api/jobs/${id}`).then(r=>r.json()),
  cancel: (id:string) => fetch(`${base}/api/jobs/${id}/cancel`,{method:'POST'}).then(r=>r.json()),
  videoUrl: (id:string) => `${base}/api/jobs/${id}/video`,
  events: (id:string) => new EventSource(`${base}/api/jobs/${id}/events`),
};
```
```

---

## 12. 完成定义（DoD）

- 一台**没装 Python** 的 Windows 机器，安装后能：配置仙宫云地址 → 测试连接成功 → 上传图 → 写提示词 → 生成 → 在应用内播放成片。
- 应用退出后无残留 backend 进程、端口释放。
- 配置文件与产物落在 `userData`，卸载不误删用户数据（由 electron-builder 决定，可保留）。
