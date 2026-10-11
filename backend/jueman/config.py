# -*- coding: utf-8 -*-
"""jue-man 配置：连接（仙宫云实例）+ 生成默认值 + 模型文件名覆盖。

数据目录（config.json / output / assets）：
  - 桌面 sidecar：读环境变量 JUEMAN_HOME（Electron 传 userData 目录）；
  - 否则：打包后为 exe 所在目录，源码运行时为项目根目录。
首次访问用 DEFAULTS 兜底，不要求文件存在。写入为原子替换。
"""
import copy
import json
import os
import sys
import threading


def _default_home():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 源码目录（静态资源定位）
HOME = os.environ.get("JUEMAN_HOME") or _default_home()             # 数据目录
CONFIG_PATH = os.path.join(HOME, "config.json")

DEFAULTS = {
    # 云端实例连接。type: xgpu(仙宫云URL直连) / autodl(SSH) / autodl_api(托管API)
    "cloud": {
        "name": "仙宫云",
        "type": "xgpu",
        "base_url": "",
        "ssh_host": "",
        "ssh_port": 22,
        "ssh_user": "root",
        "ssh_pass": "",
        "comfy_port": 8188,
        "api_base_url": "",
        "workflow_id": "",
        "token": "",
        "sampler_mode": "",          # 空=按 type 自动（xgpu->legacy, autodl->new）
        "model_prefix": "MiniMax-H3",
        "lora_prefix": None,          # None=与 model_prefix 相同；""=根目录
        "clip_name": "",              # 空=用 models.clip
        "step_probe": True,           # 提交前用 /object_info 探测分辨率节点与模型名
    },
    # 模型文件名覆盖（键见 jueman/models.py 的 _REAL）
    "models": {},
    # 生成默认值（make_workflow 的 gen）
    "gen": {
        "width": 960,
        "height": 544,
        "megapixels": 0.5,
        "duration_max": 10,
        "seed_auto": True,
        "seed": 20260812,
        "video_steps": 8,
        "audio_steps": 8,
        "shift_video": 12,
        "shift_audio": 3,
        "second_pass": False,
        "second_scale": 1.5,
        "second_denoise": 0.3,
        "second_upscaler": "learned",
        "lora_strength": 1.0,
    },
    "server": {"host": "127.0.0.1", "port": 8642},
    "output_dir": "data/output",
    "asset_dir": "data/assets",
    "job_timeout_sec": 7200,
}

_lock = threading.Lock()


def _merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load():
    disk = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                disk = json.load(fh) or {}
        except Exception:
            disk = {}
    return _merge(copy.deepcopy(DEFAULTS), disk)


def get():
    with _lock:
        return load()


def save(cfg):
    with _lock:
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)


def update(patch):
    """深合并 patch 后落盘，返回新配置。"""
    with _lock:
        cur = load()
        merged = _merge(cur, patch or {})
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(merged, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)
        return merged


def run_dir(rel):
    d = os.path.join(HOME, rel)
    os.makedirs(d, exist_ok=True)
    return d
