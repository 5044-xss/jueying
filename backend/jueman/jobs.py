# -*- coding: utf-8 -*-
"""单段生成任务管理：上传素材 → 组装工作流 → 提交 /prompt → 轮询 /history → 下载成片。

只用 ComfyUI 直连/SSH 路径（xgpu / autodl）。autodl_api 托管不在本版本范围。
"""
import os
import re
import threading
import time
import uuid

from . import config
from .engine import cloud_http, workflows
from .engine.utils import _with_resolution, _pick_video_output

JOBS = {}
_JOBS_LOCK = threading.Lock()
_RES_NODE_CACHE = {}
_RES_NODE_LOCK = threading.Lock()


MAX_IMAGES = 8  # H3 ReferenceToVideo 图参考上限

_MENTION_LABELED = re.compile(r"@(?:图片|图|image|pic)\s*#?(\d+)", re.I)
_MENTION_BARE = re.compile(r"@\s*#?(\d+)")


def _safe_name(s):
    s = re.sub(r'[\\/:*?"<>|]+', "_", str(s or "").strip())
    return (s or "jue-man")[:60]


def normalize_mentions(prompt):
    """把 @图片N / @图N / @picN / @N 统一转成 <Picture N>。"""
    s = _MENTION_LABELED.sub(lambda m: "<Picture %d>" % int(m.group(1)), prompt or "")
    s = _MENTION_BARE.sub(lambda m: "<Picture %d>" % int(m.group(1)), s)
    return s


def append_frame_notes(prompt, first_no=0, last_no=0):
    """在提示词末尾追加首/尾帧锚点声明（引用 <Picture N>）。"""
    if not first_no and not last_no:
        return prompt
    lines = ["参考帧说明："]
    if first_no:
        lines.append("<Picture %d> 是本段视频的首帧，画面必须从这一帧开始。" % first_no)
    if last_no:
        lines.append("<Picture %d> 是本段视频的尾帧，画面必须结束于这一帧。" % last_no)
    note = "\n".join(lines)
    base = (prompt or "").rstrip()
    return (base + "\n" + note) if base else note


def make_cloud(cloud_cfg):
    return cloud_http.make_client(_norm_cloud(cloud_cfg))


def _norm_cloud(cloud_cfg):
    """规整地址：去空白/尾部斜杠，缺协议头自动补 https://。"""
    cfg = dict(cloud_cfg or {})
    b = str(cfg.get("base_url") or "").strip().rstrip("/")
    if b and not b.startswith(("http://", "https://")):
        b = "https://" + b
    cfg["base_url"] = b
    for k in ("ssh_host", "ssh_user", "api_base_url", "workflow_id", "token"):
        if isinstance(cfg.get(k), str):
            cfg[k] = cfg[k].strip()
    return cfg


def new_job_dict(cloud_cfg):
    return {
        "id": "", "state": "running", "message": "已提交，等待云端…",
        "progress": {"bytes": 0, "total": 0},
        "name": "jue-man", "prompt_id": "", "cloud": dict(cloud_cfg or {}),
        "created_at": time.time(), "finished_at": None,
        "output": "", "error": "",
    }


def _resolution_node(cloud):
    """探测实例是否装了 XB_HailuoH3VideoParams（仙宫云分辨率节点），按集群缓存。"""
    key = str(cloud.cfg.get("base_url") or "") + "|" + str(cloud.cfg.get("ssh_host") or "")
    with _RES_NODE_LOCK:
        if key in _RES_NODE_CACHE:
            return _RES_NODE_CACHE[key]
    hit = ""
    try:
        info = cloud.object_info(timeout=30) or {}
        if "XB_HailuoH3VideoParams" in {str(k) for k in info}:
            hit = "xb"
    except Exception:
        hit = ""
    with _RES_NODE_LOCK:
        _RES_NODE_CACHE[key] = hit
    return hit


def catalog(cloud):
    """列实例已装节点与可用模型文件（给前端下拉/校验用）。"""
    info = cloud.object_info(timeout=30) or {}
    nodes = sorted(str(k) for k in info)

    def options(node):
        d = info.get(node) or {}
        req = (d.get("input") or {}).get("required") or {}
        for _field, spec in req.items():
            if isinstance(spec, list) and spec and isinstance(spec[0], list):
                return [str(x) for x in spec[0]]
        return []

    def viruses(node):
        return options(node)

    return {
        "nodes": nodes,
        "files": {
            "unet": viruses("UNETLoader"),
            "clip": viruses("CLIPLoader"),
            "lora": viruses("LoraLoaderModelOnly"),
            "vae": viruses("VAELoader"),
        },
        "has_xb_resolution": "XB_HailuoH3VideoParams" in set(nodes),
        "has_savevideo": "SaveVideo" in set(nodes),
        "has_vhs": "VHS_VideoCombine" in set(nodes),
    }


def test_cloud(cloud_cfg):
    cloud = make_cloud(cloud_cfg)
    ok, detail = cloud.test()
    result = {"ok": bool(ok), "detail": detail}
    if ok:
        try:
            result["catalog"] = catalog(cloud)
        except Exception as exc:
            result["catalog_error"] = str(exc)[:200]
    return result


def _queue_state(cloud, prompt_id):
    try:
        q = cloud.queue() or {}
    except Exception:
        return None
    for item in q.get("queue_running") or []:
        if len(item) > 1 and item[1] == prompt_id:
            return "running"
    for item in q.get("queue_pending") or []:
        if len(item) > 1 and item[1] == prompt_id:
            return "queued"
    return None


def _finish(job, state, error="", message=""):
    with _JOBS_LOCK:
        if job.get("state") in ("success", "error", "cancelled"):
            return
        job["state"] = state
        job["finished_at"] = time.time()
        if error:
            job["error"] = error
        if message:
            job["message"] = message


def _poll_worker(job_id):
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return
    cfg = config.get()
    cloud = make_cloud(cfg["cloud"])
    pid = job["prompt_id"]
    deadline = time.time() + int(cfg.get("job_timeout_sec") or 2700)
    out_dir = config.run_dir(cfg.get("output_dir") or "data/output")

    while True:
        with _JOBS_LOCK:
            if job.get("state") in ("cancelled",):
                return
        if time.time() > deadline:
            _finish(job, "error", error="生成超时（%d 秒）" % int(cfg.get("job_timeout_sec") or 2700))
            return
        try:
            h = cloud.history(pid)
        except Exception as exc:
            with _JOBS_LOCK:
                job["message"] = "查询失败，重试中：%s" % str(exc)[:120]
            time.sleep(4)
            continue

        st = ""
        if isinstance(h, dict):
            st = ((h.get("status") or {}).get("status_str") or "").lower()
        out = _pick_video_output(h) if isinstance(h, dict) else None

        if st == "success" or out:
            if not out:
                _finish(job, "error", error="云端完成但未找到视频输出")
                return
            fname = out.get("filename") or ""
            sub = out.get("subfolder") or ""
            dest = os.path.join(out_dir, "%s-%s.mp4" % (job["name"], job_id[:8]))

            def _cb(done, total):
                with _JOBS_LOCK:
                    job["progress"] = {"bytes": int(done or 0), "total": int(total or 0)}
                    job["message"] = "正在回传成片…"

            try:
                cloud.download(fname, subfolder=sub, out_type="output",
                               local_path=dest, progress=_cb)
            except Exception as exc:
                _finish(job, "error", error="下载失败：%s" % str(exc)[:160])
                return
            with _JOBS_LOCK:
                job["output"] = dest
            _finish(job, "success", message="完成")
            return

        if st == "error":
            msg = ""
            if isinstance(h, dict):
                msg = h.get("status") or h.get("error") or ""
            _finish(job, "error", error=str(msg)[:200] or "云端执行失败")
            return

        qs = _queue_state(cloud, pid)
        with _JOBS_LOCK:
            job["message"] = {"running": "生成中…", "queued": "排队中…",
                              None: "等待云端…"}.get(qs, "生成中…")
        time.sleep(3)


def create_job(req):
    """req: prompt, title, duration, aspect, resolution, seed,
    images[本地路径], audios[本地路径], sampler_mode, model_variant。"""
    cfg = config.get()
    cloud_cfg = dict(cfg.get("cloud") or {})
    ctype = str(cloud_cfg.get("type") or "xgpu").lower()
    if ctype == "autodl_api":
        raise RuntimeError("本版本暂只支持 ComfyUI 直连/SSH（xgpu / autodl），不含 autodl_api 托管")
    if not cloud_cfg.get("base_url") and not cloud_cfg.get("ssh_host"):
        raise RuntimeError("未配置云端地址：请先在设置里填写仙宫云 base_url")

    cloud = make_cloud(cloud_cfg)
    ok, detail = cloud.test()
    if not ok:
        raise RuntimeError("云端不可用：%s" % (detail or "无法连接"))

    # 参考图顺序：用户图 → 首帧 → 尾帧；<Picture N> 编号与此顺序一致。
    subj = list(req.get("images") or [])
    first_path = req.get("firstFrame") or ""
    last_path = req.get("lastFrame") or ""
    if first_path and not os.path.exists(first_path):
        raise RuntimeError("首帧文件不存在")
    if last_path and not os.path.exists(last_path):
        raise RuntimeError("尾帧文件不存在")
    frames = [p for p in (first_path, last_path) if p]
    if len(subj) + len(frames) > MAX_IMAGES:
        raise RuntimeError("参考图过多：图+首/尾帧最多 %d 张" % MAX_IMAGES)
    ordered = subj + frames
    first_no = (len(subj) + 1) if first_path else 0
    last_no = (len(subj) + (1 if first_path else 0) + 1) if last_path else 0

    try:
        images_remote = [cloud.upload(p)["name"] for p in ordered]
        audios_remote = [cloud.upload(p)["name"] for p in (req.get("audios") or [])]
    except Exception as exc:
        raise RuntimeError("素材上传失败：%s" % str(exc)[:200])

    prompt_text = append_frame_notes(
        normalize_mentions(str(req.get("prompt") or "")), first_no, last_no)

    gen = _with_resolution(cfg.get("gen") or {}, req.get("resolution") or "",
                           req.get("aspect") or "")
    if req.get("seed"):
        gen["seed_auto"] = False
        gen["seed"] = int(req["seed"])
    duration = int(req.get("duration") or gen.get("duration_max") or 10)
    name = _safe_name(req.get("title") or "jue-man")

    rn = _resolution_node(cloud)
    if not rn and ctype != "autodl":
        rn = "xb"
    sm = str(req.get("sampler_mode") or cloud_cfg.get("sampler_mode") or "")
    if not sm:
        sm = "new" if ctype == "autodl" else "legacy"

    wf = workflows.make_workflow(
        prompt_text,
        name,
        {"images": images_remote, "audios": audios_remote, "videos": []},
        gen,
        duration=duration,
        model_prefix=cloud_cfg.get("model_prefix") or workflows.DEFAULT_MODEL_PREFIX,
        lora_prefix=cloud_cfg.get("lora_prefix"),
        clip_name=cloud_cfg.get("clip_name") or None,
        sampler_mode=sm,
        resolution_node=rn,
        size=req.get("aspect") or "",
        resolution=req.get("resolution") or "",
        model_variant=req.get("model_variant") or "auto",
    )

    resp = cloud.submit(wf)
    pid = (resp or {}).get("prompt_id") or (resp or {}).get("task_id") or ""
    if not pid:
        raise RuntimeError("云端未返回 prompt_id：%s" % str(resp)[:200])

    job_id = uuid.uuid4().hex
    job = new_job_dict(cloud_cfg)
    job.update({
        "id": job_id, "name": name, "prompt_id": pid,
        "message": "已提交，等待云端…",
        "assets": {"images": images_remote, "audios": audios_remote},
        "params": {"duration": duration, "aspect": req.get("aspect"),
                   "resolution": req.get("resolution"), "sampler_mode": sm,
                   "resolution_node": rn, "firstNo": first_no, "lastNo": last_no},
        "prompt": prompt_text,
    })
    with _JOBS_LOCK:
        JOBS[job_id] = job
    threading.Thread(target=_poll_worker, args=(job_id,),
                     name="jueman-poll-%s" % job_id[:8], daemon=True).start()
    return public_job(job)


def cancel_job(job_id):
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise RuntimeError("任务不存在：%s" % job_id)
    cloud = make_cloud(config.get()["cloud"])
    try:
        cloud.interrupt()
    except Exception:
        pass
    try:
        cloud.queue_delete([job.get("prompt_id")])
    except Exception:
        pass
    _finish(job, "cancelled", message="已取消")
    return public_job(job)


def public_job(job):
    with _JOBS_LOCK:
        j = dict(job)
    out = {
        "id": j.get("id"), "state": j.get("state"), "message": j.get("message"),
        "progress": j.get("progress"),
        "name": j.get("name"), "promptId": j.get("prompt_id"),
        "createdAt": j.get("created_at"), "finishedAt": j.get("finished_at"),
        "error": j.get("error") or "",
        "params": j.get("params") or {},
        "prompt": j.get("prompt") or "",
        "videoUrl": ("/api/jobs/%s/video" % j.get("id")) if j.get("output") else "",
    }
    return out


def get_job(job_id):
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
    return public_job(job) if job else None


def get_job_raw(job_id):
    with _JOBS_LOCK:
        return JOBS.get(job_id)


def list_jobs():
    with _JOBS_LOCK:
        items = list(JOBS.values())
    items.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    return [public_job(j) for j in items]
