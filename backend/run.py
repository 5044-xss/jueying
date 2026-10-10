# -*- coding: utf-8 -*-
"""jue-man 启动入口。

端口优先级：--port 参数 > 环境变量 JUEMAN_PORT > config.server.port > 8642。
主机优先级：--host 参数 > config.server.host > 127.0.0.1。
启动成功后在 stdout 打印一行 `JUEMAN_READY http://host:port`（供 Electron 探活）。

源码运行：  python run.py
桌面 sidecar：JUEMAN_HOME=<userData> JUEMAN_PORT=<port> jueman-backend.exe
"""
import argparse
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402

from jueman import config  # noqa: E402
from jueman.api import app  # noqa: E402


def _resolve(host, port):
    cfg = config.get()
    s = cfg.get("server") or {}
    if port is None:
        env_port = os.environ.get("JUEMAN_PORT")
        if env_port:
            try:
                port = int(env_port)
            except ValueError:
                port = None
    if port is None:
        port = int(s.get("port") or 8642)
    if host is None:
        host = s.get("host") or "127.0.0.1"
    return host, int(port)


def main():
    ap = argparse.ArgumentParser(description="jue-man 后端服务")
    ap.add_argument("--host", default=None, help="监听地址（默认取配置/127.0.0.1）")
    ap.add_argument("--port", type=int, default=None, help="监听端口（默认取配置/8642）")
    args = ap.parse_args()

    host, port = _resolve(args.host, args.port)
    print("jue-man 启动 → http://%s:%d  (HOME=%s)" % (host, port, config.HOME), flush=True)

    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info"))

    def _announce():
        while not server.started and not server.should_exit:
            time.sleep(0.2)
        if server.started:
            print("JUEMAN_READY http://%s:%d" % (host, port), flush=True)

    threading.Thread(target=_announce, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
