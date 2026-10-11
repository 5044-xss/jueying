此目录用于放置 PyInstaller 打包出的后端可执行文件：

  jueman-backend.exe

构建（在 backend 后端目录）：
  pip install pyinstaller
  pyinstaller jueman-backend.spec
  拷贝 dist\\jueman-backend.exe 到 resources\\backend\\jueman-backend.exe

electron-builder 会把 resources/backend 整个目录复制到安装包的 resources/backend，
主进程按 process.resourcesPath/backend/jueman-backend.exe 启动它。
