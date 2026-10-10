# jueying

jueying 视频生成工作台（桌面端 + Python 后端）。

## 结构

```
jueying/
  frontend/   Electron + Vite + React + TypeScript 桌面端
  backend/    Python FastAPI 视频生成服务（ComfyUI 客户端）
```

- 前端界面与实施计划见 `frontend/README.md`
- 架构 / 里程碑计划见 `backend/DESKTOP-PLAN.md`

## 开发

```powershell
# 终端 A：后端（127.0.0.1:8642）
cd backend
pip install -r requirements.txt
python run.py

# 终端 B：前端 + Electron
cd frontend
npm install
npm run dev:electron
```

## 打包

```powershell
# 1) 后端 exe
cd backend
pip install pyinstaller
pyinstaller jueman-backend.spec
copy dist\jueman-backend.exe ..\frontend\resources\backend\

# 2) 桌面端
cd ..\frontend
npm run build
npm run dist                 # electron-builder → release\
```

## 说明

- 后端只绑 `127.0.0.1`，桌面端通过本地回环调用，不暴露公网。
- 运行时配置与产物（`config.json`、`data/`）落在 Electron `userData` 目录，不入库。
- 生产打包时后端 exe 作为 sidecar 打进桌面端 `resources/backend/`。
