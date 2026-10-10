# -*- coding: utf-8 -*-
"""jue-man HTTP API（前端完全独立，经此服务调用 Python 生成引擎）。

接口：
  GET  /api/health
  GET  /api/settings / PUT /api/settings
  POST /api/cloud/test
  GET  /api/cloud/catalog
  POST /api/assets (multipart)   GET /api/assets   GET /api/assets/{id}
  POST /api/jobs    GET /api/jobs    GET /api/jobs/{id}
  GET  /api/jobs/{id}/events     POST /api/jobs/{id}/cancel
  GET  /api/jobs/{id}/video

POST /api/jobs body:
  prompt, title, duration(4-15), aspect, resolution(MP), seed,
  images:[assetId...], audios:[assetId...], firstFrame:assetId, lastFrame:assetId,
  samplerMode("legacy"/"new"/空自动), modelVariant("auto"/"fl2va"/"ref2va")
参考图顺序 = images → firstFrame → lastFrame，对应 <Picture 1..N>；
prompt 里的 @图片N / @图N / @N 会自动转成 <Picture N>。
"""
import os
import json
import threading
import time
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from . import config
from . import jobs as jobs_svc

app = FastAPI(title="jue-man", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ASSETS = {}
_ASSETS_LOCK = threading.Lock()
_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"}


def _ext(name):
    return os.path.splitext(name or "")[1].lower()


@app.get("/")
def index():
    page = os.path.join(_STATIC_DIR, "index.html")
    if not os.path.exists(page):
        raise HTTPException(status_code=404, detail="自测页不存在")
    return FileResponse(page)


@app.get("/api/health")
def health():
    cfg = config.get()
    return {"ok": True, "version": app.version,
            "configured": bool((cfg.get("cloud") or {}).get("base_url")
                               or (cfg.get("cloud") or {}).get("ssh_host"))}


@app.get("/api/settings")
def get_settings():
    return config.get()


@app.put("/api/settings")
def put_settings(patch: dict):
    return config.update(patch or {})


@app.post("/api/cloud/test")
def cloud_test(patch: dict | None = None):
    cfg = config.get()
    cloud_cfg = cfg.get("cloud") or {}
    if patch and isinstance(patch.get("cloud"), dict):
        cloud_cfg = {**cloud_cfg, **patch["cloud"]}
    try:
        return jobs_svc.test_cloud(cloud_cfg)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:300])


@app.get("/api/cloud/catalog")
def cloud_catalog():
    cfg = config.get()
    cloud = jobs_svc.make_cloud(cfg.get("cloud") or {})
    try:
        return jobs_svc.catalog(cloud)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:300])


@app.post("/api/assets")
async def upload_asset(file: UploadFile = File(...), kind: str = Form("image")):
    kind = (kind or "image").strip().lower()
    if kind not in ("image", "audio"):
        raise HTTPException(status_code=400, detail="kind 只能是 image 或 audio")
    ext = _ext(file.filename)
    allowed = _IMAGE_EXT if kind == "image" else _AUDIO_EXT
    if ext not in allowed:
        raise HTTPException(status_code=400,
                            detail="不支持的扩展名：%s" % (ext or "(无)"))
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    aid = uuid.uuid4().hex
    asset_dir = (config.get().get("asset_dir") or "data/assets")
    dst = os.path.join(config.run_dir(asset_dir), aid + ext)
    with open(dst, "wb") as fh:
        fh.write(data)
    info = {"id": aid, "kind": kind, "name": file.filename or (aid + ext),
            "path": dst, "size": len(data)}
    with _ASSETS_LOCK:
        _ASSETS[aid] = info
    return info


@app.get("/api/assets")
def list_assets():
    with _ASSETS_LOCK:
        items = list(_ASSETS.values())
    items.sort(key=lambda x: x["id"])
    return [{"id": a["id"], "kind": a["kind"], "name": a["name"], "size": a["size"]}
            for a in items]


@app.get("/api/assets/{aid}")
def get_asset(aid: str):
    with _ASSETS_LOCK:
        info = _ASSETS.get(aid)
    if not info or not os.path.exists(info["path"]):
        raise HTTPException(status_code=404, detail="素材不存在")
    return FileResponse(info["path"], filename=info["name"])


def _resolve_assets(ids):
    out = []
    with _ASSETS_LOCK:
        for aid in ids or []:
            info = _ASSETS.get(str(aid))
            if not info:
                raise HTTPException(status_code=400, detail="素材不存在：%s" % aid)
            if not os.path.exists(info["path"]):
                raise HTTPException(status_code=400, detail="素材文件已失效：%s" % aid)
            out.append(info["path"])
    return out


def _resolve_one(aid):
    if not aid:
        return ""
    return _resolve_assets([aid])[0]


@app.post("/api/jobs")
def create_job(body: dict):
    body = body or {}
    if not str(body.get("prompt") or "").strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    req = {
        "prompt": body.get("prompt"),
        "title": body.get("title"),
        "duration": body.get("duration"),
        "aspect": body.get("aspect") or "16:9",
        "resolution": body.get("resolution") or "0.5",
        "seed": body.get("seed") or 0,
        "images": _resolve_assets(body.get("images")),
        "audios": _resolve_assets(body.get("audios")),
        "firstFrame": _resolve_one(body.get("firstFrame") or body.get("first_frame")),
        "lastFrame": _resolve_one(body.get("lastFrame") or body.get("last_frame")),
        "sampler_mode": body.get("samplerMode") or body.get("sampler_mode"),
        "model_variant": body.get("modelVariant") or body.get("model_variant"),
    }
    try:
        return jobs_svc.create_job(req)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:300])


@app.get("/api/jobs")
def list_jobs():
    return jobs_svc.list_jobs()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs_svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@app.get("/api/jobs/{job_id}/video")
def get_job_video(job_id: str):
    raw = jobs_svc.get_job_raw(job_id)
    if not raw or not raw.get("output") or not os.path.exists(raw["output"]):
        raise HTTPException(status_code=404, detail="成片不存在或尚未完成")
    return FileResponse(raw["output"], media_type="video/mp4",
                        filename="%s.mp4" % (raw.get("name") or "jue-man"))


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    try:
        return jobs_svc.cancel_job(job_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:300])


@app.get("/api/jobs/{job_id}/events")
def job_events(job_id: str):
    """SSE：任务状态/进度变化时推送，结束发送 event: done。"""
    if not jobs_svc.get_job(job_id):
        raise HTTPException(status_code=404, detail="任务不存在")

    def gen():
        last = None
        while True:
            job = jobs_svc.get_job(job_id)
            if not job:
                yield "event: error\ndata: lost\n\n"
                return
            payload = json.dumps(job, ensure_ascii=False)
            if payload != last:
                last = payload
                yield "data: %s\n\n" % payload
            if job.get("state") in ("success", "error", "cancelled"):
                yield "event: done\ndata: %s\n\n" % payload
                return
            time.sleep(1.5)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
