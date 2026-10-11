# -*- coding: utf-8 -*-
"""案例模板：随安装包分发的内置案例（列表 / 演示视频 / 导入到记录）。

案例目录：HOME/cases/<name>/，含 case.json + assets/ + output/ + cover.*。
案例包 cases.zip 首次使用时从 GitHub Release 下载并解压到 HOME/cases/。
"""
import json
import os
import shutil
import threading
import time
import urllib.request
import uuid
import zipfile

from . import config

CASES_REPO = "5044-xss/jueying"
CASES_ASSET = "cases.zip"

_install = {"state": "idle", "progress": 0, "error": "", "updated_at": 0.0}
_install_lock = threading.Lock()


def cases_dir():
    d = os.path.join(config.HOME, "cases")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def _assets_path():
    d = os.path.join(config.HOME, "data")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "assets.json")


def _load_assets():
    try:
        with open(_assets_path(), "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except Exception:
        return {}


def _save_assets(a):
    p = _assets_path()
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(a, fh, ensure_ascii=False)
    os.replace(tmp, p)


def _case_dir(name):
    safe = os.path.basename(str(name or ""))
    if not safe or safe in (".", ".."):
        raise RuntimeError("非法案例名")
    return os.path.join(cases_dir(), safe)


def _read_meta(name):
    cd = _case_dir(name)
    p = os.path.join(cd, "case.json")
    if not os.path.isfile(p):
        raise RuntimeError("案例不存在")
    with open(p, "r", encoding="utf-8") as fh:
        return cd, json.load(fh)


def list_cases():
    d = cases_dir()
    items = []
    try:
        names = sorted(os.listdir(d))
    except Exception:
        names = []
    for n in names:
        cd = os.path.join(d, n)
        mp = os.path.join(cd, "case.json")
        if not os.path.isfile(mp):
            continue
        try:
            with open(mp, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
        except Exception:
            meta = {"name": n}
        cover = meta.get("cover") or ""
        items.append({
            "name": meta.get("name") or n,
            "hasCover": bool(cover and os.path.isfile(os.path.join(cd, cover))),
            "shots": len(meta.get("shots") or []),
        })
    return {"installed": len(items) > 0, "items": items}


def case_cover(name):
    cd, meta = _read_meta(name)
    cover = meta.get("cover") or ""
    p = os.path.join(cd, cover)
    if not cover or not os.path.isfile(p):
        raise RuntimeError("案例演示视频不存在")
    return p


# —— 案例包下载 / 安装 ——
def _set_install(**kw):
    with _install_lock:
        _install.update(kw)
        _install["updated_at"] = time.time()


def install_status():
    with _install_lock:
        return dict(_install)


def _asset_api_url():
    api = "https://api.github.com/repos/%s/releases/latest" % CASES_REPO
    req = urllib.request.Request(api, headers={
        "User-Agent": "jueying", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    for a in data.get("assets") or []:
        if a.get("name") == CASES_ASSET:
            return a.get("url")
    raise RuntimeError("发布里没有 %s" % CASES_ASSET)


def _install_worker():
    try:
        _set_install(state="downloading", progress=0, error="")
        url = _asset_api_url()
        part = os.path.join(cases_dir(), CASES_ASSET + ".part")
        req = urllib.request.Request(url, headers={
            "User-Agent": "jueying", "Accept": "application/octet-stream"})
        with urllib.request.urlopen(req, timeout=120) as r, open(part, "wb") as fh:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = r.read(1024 * 256)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    _set_install(progress=int(done * 100 / total))
        with zipfile.ZipFile(part, "r") as z:
            z.extractall(cases_dir())
        try:
            os.remove(part)
        except Exception:
            pass
        _set_install(state="done", progress=100, error="")
    except Exception as exc:
        _set_install(state="error", error=str(exc)[:300])


def start_install():
    with _install_lock:
        if _install.get("state") == "downloading":
            return dict(_install)
    _set_install(state="downloading", progress=0, error="")
    threading.Thread(target=_install_worker, name="cases-install", daemon=True).start()
    return install_status()


def import_case(name, project=None):
    """把案例的全部镜头导入到「记录」：复制参考图/成片，生成可再编辑的任务。"""
    from . import jobs as jobs_svc

    cd, meta = _read_meta(name)
    shots = meta.get("shots") or []
    if not shots:
        raise RuntimeError("该案例暂无可导入镜头")

    target = str(project or meta.get("name") or name).strip()
    assets = _load_assets()
    asset_dir = config.run_dir(config.get().get("asset_dir") or "data/assets")
    out_dir = config.run_dir(config.get().get("output_dir") or "data/output")
    image_map = {}

    def import_image(rel):
        if not rel:
            return None
        src = os.path.join(cd, rel)
        if not os.path.isfile(src):
            return None
        key = os.path.normcase(os.path.abspath(src))
        if key in image_map:
            return image_map[key]
        aid = uuid.uuid4().hex
        ext = os.path.splitext(src)[1]
        dst = os.path.join(asset_dir, aid + ext)
        shutil.copy2(src, dst)
        assets[aid] = {"id": aid, "kind": "image", "name": os.path.basename(src),
                       "path": dst, "size": os.path.getsize(dst)}
        image_map[key] = aid
        return aid

    now = time.time()
    created = 0
    created_ids = []
    for i, shot in enumerate(shots):
        imgs = [x for x in (import_image(r) for r in (shot.get("images") or [])) if x]
        first = import_image(shot.get("firstFrame"))
        last = import_image(shot.get("lastFrame"))
        src_video = os.path.join(cd, shot.get("video") or "")
        jid = uuid.uuid4().hex
        dst_video = ""
        if shot.get("video") and os.path.isfile(src_video):
            name_part = jobs_svc._safe_name(shot.get("name") or ("%s-%d" % (name, i + 1)))
            dst_video = os.path.join(out_dir, "%s-%s.mp4" % (name_part, jid[:8]))
            shutil.copy2(src_video, dst_video)
        size = os.path.getsize(dst_video) if dst_video else 0
        job = {
            "id": jid, "state": "success", "message": "案例导入",
            "progress": {"bytes": size, "total": size},
            "name": shot.get("name") or ("%s-%d" % (name, i + 1)),
            "prompt_id": "", "cloud": {},
            "created_at": now, "finished_at": now,
            "output": dst_video, "error": "",
            "params": shot.get("params") or {},
            "prompt": shot.get("prompt") or "",
            "inputs": {"images": imgs, "audios": [],
                       "firstFrame": first, "lastFrame": last},
            "project": target,
        }
        jobs_svc.add_record(job)
        created += 1
        created_ids.append(jid)

    _save_assets(assets)
    jobs_svc.save()
    return {"ok": True, "project": target, "count": created, "ids": created_ids}
