# -*- mode: python ; coding: utf-8 -*-
"""jue-man 后端打包（PyInstaller 6.x，onefile）。

    cd E:\\appData\\h3-app\\jue-man
    pip install pyinstaller
    pyinstaller jueman-backend.spec
    # 产物：dist\\jueman-backend.exe  → 拷到 jue-man-desktop\\resources\\backend\\

桌面端由 Electron spawn 该 exe，并注入：
    JUEMAN_HOME = <userData>     （配置/产物目录）
    JUEMAN_PORT = <port>         （监听端口）
"""
import os

from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.dirname(os.path.abspath(SPEC))

hiddenimports = [
    "jueman",
    "jueman.api",
    "jueman.cases",
    "jueman.config",
    "jueman.jobs",
    "jueman.models",
    "jueman.engine",
    "jueman.engine.cloud_http",
    "jueman.engine.workflows",
    "jueman.engine.utils",
]
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("fastapi")
hiddenimports += collect_submodules("starlette")

a = Analysis(
    [os.path.join(ROOT, "run.py")],
    pathex=[ROOT],
    binaries=[],
    datas=[(os.path.join(ROOT, "jueman", "static"), "jueman/static")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # xgpu 直连路径用不到 paramiko / PIL，缩减体积（若日后加 SSH/autodl_api 再去掉）
    excludes=["paramiko", "PIL"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="jueman-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # 需要读 stdout 的 JUEMAN_READY 探活；正式发布可改 False 并改为轮询 /api/health
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
