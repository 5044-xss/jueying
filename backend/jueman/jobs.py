# -*- coding: utf-8 -*-
"""单段生成任务管理：上传素材 → 组装工作流 → 提交 /prompt → 轮询 /history → 下载成片。

只用 ComfyUI 直连/SSH 路径（xgpu / autodl）。autodl_api 托管不在本版本范围。
"""
import json
import os
import re
import shutil
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


def _jobs_path():
    """任务持久化文件：HOME/data/jobs.json（与 output/assets 同盘）。"""
    d = os.path.join(config.HOME, "data")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "jobs.json")


def _save_jobs():
    """把任务快照原子落盘（锁内序列化，锁外写文件）。"""
    try:
        with _JOBS_LOCK:
            payload = json.dumps(JOBS, ensure_ascii=False)
        p = _jobs_path()
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp, p)
    except Exception:
        pass


def _load_jobs():
    """启动时读取历史任务；上次未结束的标记为中断，避免出现假运行态。"""
    try:
        with open(_jobs_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return
    if not isinstance(data, dict):
        return
    changed = False
    for jid, job in data.items():
        if not isinstance(job, dict):
            continue
        if job.get("state") in ("running", "queued"):
            job["state"] = "error"
            job["error"] = "应用重启，任务中断"
            job["finished_at"] = time.time()
            changed = True
        JOBS[jid] = job
    if changed:
        _save_jobs()


_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv")


def _reconcile_outputs():
    """把 output 目录里没有对应记录的成片回填成历史条目（可播放，无提示词/参数）。

    用于找回早期「只存内存、未持久化」时期生成的成片；已回填过的不会重复添加。
    """
    try:
        cfg = config.get()
        out_dir = config.run_dir(cfg.get("output_dir") or "data/output")
    except Exception:
        return

    with _JOBS_LOCK:
        known = {
            os.path.normcase(os.path.abspath(j["output"]))
            for j in JOBS.values()
            if j.get("output")
        }

    try:
        entries = os.listdir(out_dir)
    except Exception:
        return

    added = False
    for fname in entries:
        if not fname.lower().endswith(_VIDEO_EXTS):
            continue
        full = os.path.join(out_dir, fname)
        try:
            if not os.path.isfile(full) or os.path.getsize(full) < 1024:
                continue
            size = os.path.getsize(full)
            mt = os.path.getmtime(full)
        except Exception:
            continue
        if os.path.normcase(os.path.abspath(full)) in known:
            continue

        stem = os.path.splitext(fname)[0]
        # 生成时文件名形如 <name>-<id8>（id8 为 8 位十六进制）
        m = re.match(r"^(?P<name>.*)-(?P<id>[0-9a-fA-F]{8})$", stem)
        name = (m.group("name") if m else stem) or "clip"
        jid = (m.group("id") if m else uuid.uuid4().hex[:8]).lower()
        base, n = jid, 1
        while jid in JOBS:
            jid = "%s%02d" % (base, n)
            n += 1

        JOBS[jid] = {
            "id": jid, "state": "success", "message": "完成",
            "progress": {"bytes": size, "total": size},
            "name": name, "prompt_id": "", "cloud": {},
            "created_at": mt, "finished_at": mt,
            "output": full, "error": "", "params": {}, "prompt": "",
            "backfilled": True,
        }
        added = True

    if added:
        _save_jobs()


_load_jobs()
_reconcile_outputs()


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
        "output": "", "error": "", "project": "",
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
    _save_jobs()


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
        _save_jobs()
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
        "inputs": {
            "images": list(req.get("input_images") or []),
            "audios": list(req.get("input_audios") or []),
            "firstFrame": req.get("input_first") or None,
            "lastFrame": req.get("input_last") or None,
        },
        "params": {"duration": duration, "aspect": req.get("aspect"),
                   "resolution": req.get("resolution"), "sampler_mode": sm,
                   "resolution_node": rn, "firstNo": first_no, "lastNo": last_no},
        "prompt": prompt_text,
    })
    with _JOBS_LOCK:
        JOBS[job_id] = job
    _save_jobs()
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


def update_job(job_id, name=None, project=None):
    """重命名任务 / 修改所属项目分组。只动元数据，不碰成片文件。"""
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise RuntimeError("任务不存在：%s" % job_id)
        if name is not None and str(name).strip():
            job["name"] = _safe_name(name)
        if project is not None:
            job["project"] = str(project).strip()[:60]
    _save_jobs()
    return public_job(job)


def delete_job(job_id):
    """删除任务记录及其成片文件；进行中/排队中的任务不允许删除。"""
    with _JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise RuntimeError("任务不存在：%s" % job_id)
        if job.get("state") in ("running", "queued"):
            raise RuntimeError("任务进行中，无法删除")
        out = job.get("output") or ""
        JOBS.pop(job_id, None)
    _save_jobs()
    if out:
        try:
            if os.path.isfile(out):
                os.remove(out)
        except Exception:
            pass
    return {"ok": True, "id": job_id}


def _copy_video(src, name, new_id):
    """把成片复制一份（删除副本不影响原片）；复制失败则共享原路径。"""
    if not src or not os.path.isfile(src):
        return src or ""
    ext = os.path.splitext(src)[1] or ".mp4"
    dest = os.path.join(os.path.dirname(src), "%s-%s%s" % (_safe_name(name), new_id[:8], ext))
    try:
        shutil.copy2(src, dest)
        return dest
    except Exception:
        return src


def duplicate_project(source, name=None):
    """把某个分组（project）下的全部任务复制成一份新的可编辑项目。

    复制内容：提示词、参数、参考素材（inputs）、成片（视频文件另存一份）。
    """
    src = str(source or "").strip()
    if not src:
        raise RuntimeError("缺少分组名")
    with _JOBS_LOCK:
        items = [dict(j) for j in JOBS.values() if (j.get("project") or "") == src]
        existing = {(j.get("project") or "") for j in JOBS.values()}
    if not items:
        raise RuntimeError("该分组暂无内容")

    target = str(name).strip() if name else src
    base = target
    i = 0
    while target in existing and target:
        i += 1
        target = ("%s-副本" % base) if i == 1 else ("%s-副本%d" % (base, i))

    now = time.time()
    created = []
    for j in items:
        new_id = uuid.uuid4().hex
        new_job = dict(j)
        new_job["id"] = new_id
        new_job["project"] = target
        new_job["output"] = _copy_video(j.get("output") or "", j.get("name") or "clip", new_id)
        new_job["created_at"] = now
        new_job["finished_at"] = now
        with _JOBS_LOCK:
            JOBS[new_id] = new_job
        created.append(new_id)
    _save_jobs()
    return {"ok": True, "project": target, "count": len(created)}


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
        "inputs": j.get("inputs") or {},
        "project": j.get("project") or "",
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
