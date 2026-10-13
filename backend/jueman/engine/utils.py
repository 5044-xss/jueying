# -*- coding: utf-8 -*-
"""生成链路用得上的纯函数 helper（从原 cloud_utils.py 抽取，去掉无关依赖）。"""
import math

# H3 原生分辨率上限（≈768p）；超过是“虚胖”，一律夹取。
MAX_MEGAPIXELS = 0.98


def _with_resolution(gen, resolution, size=""):
    """按清晰度(MP)与画幅把 width/height 写进 gen 的副本。

    resolution: "0.4"/"0.5"/"0.7"/"0.98" 或 low/mid/high；size: "16:9"/"9:16"/...
    命中 native 表时用精确尺寸，否则按面积+比例算 32 对齐尺寸。
    超过 native 上限（0.98MP）的清晰度一律夹取到 0.98。
    """
    g = dict(gen or {})
    res = (resolution or "").strip().lower()
    sz = (size or "").strip().lower()
    if not res and not sz:
        return g
    mp_table = {"0.4": 0.4, "0.5": 0.5, "0.7": 0.7, "0.98": 0.98,
                "low": 0.5, "mid": 1.0, "1": 1.0,
                "1.5": 1.5, "2": 2.0, "high": 2.0}
    ratio_table = {"16:9": 16.0 / 9.0, "9:16": 9.0 / 16.0, "1:1": 1.0,
                   "4:3": 4.0 / 3.0, "3:4": 3.0 / 4.0}
    mp = mp_table.get(res)
    if mp is None:
        try:
            mp = float(res)
        except (TypeError, ValueError):
            mp = None
    if mp is None:
        mp = g.get("megapixels") or 1.0
    ratio = ratio_table.get(sz, ratio_table.get("16:9"))
    _alias = {"low": "0.5", "mid": "1", "high": "2"}
    res_key = _alias.get(res, res)
    _canon = {0.4: "0.4", 0.5: "0.5", 1.0: "1", 1.5: "1.5", 2.0: "2"}
    try:
        _fval = float(res_key)
        res_key = _canon.get(_fval, res_key)
    except (TypeError, ValueError):
        pass
    if not res_key:
        _near = min(_canon.keys(), key=lambda k: abs(k - mp))
        res_key = _canon[_near]
        mp = _near
    native = {
        ("16:9", "0.4"): (864, 480), ("16:9", "0.5"): (960, 544),
        ("16:9", "1"): (1344, 768), ("16:9", "1.5"): (1600, 896),
        ("16:9", "2"): (1920, 1088),
        ("9:16", "0.4"): (480, 864), ("9:16", "0.5"): (544, 960),
        ("9:16", "1"): (768, 1344), ("9:16", "1.5"): (896, 1600),
        ("9:16", "2"): (1088, 1920),
    }
    _native_sz = sz if sz else "16:9"
    n = native.get((_native_sz, res_key))
    if n and (n[0] * n[1] / 1e6) <= MAX_MEGAPIXELS + 1e-6:
        g["width"], g["height"] = n
        g["megapixels"] = round(n[0] * n[1] / 1e6, 3)
        return g
    if mp and ratio:
        mp = min(mp, MAX_MEGAPIXELS)
        area = mp * 1_000_000
        _w = int(math.sqrt(area * ratio) / 32) * 32
        _h = int(math.sqrt(area / ratio) / 32) * 32
        _w = max(256, min(5760, _w))
        _h = max(256, min(5760, _h))
        g["width"], g["height"] = _w, _h
        g["megapixels"] = round(_w * _h / 1e6, 3)
    return g


def _pick_video_output(h):
    """兼容新旧版视频输出节点：旧 VHS_VideoCombine(237) 输出 gifs，新版 SaveVideo 输出 video。"""
    outs = (h or {}).get("outputs") or {}
    for node_id in ("237", "92"):
        for key in ("gifs", "video", "images"):
            arr = (outs.get(node_id) or {}).get(key) or []
            if arr and arr[0].get("filename"):
                return arr[0]
    for node_id, node_out in outs.items():
        for key in ("gifs", "video"):
            arr = node_out.get(key) or []
            if arr and arr[0].get("filename"):
                return arr[0]
    return None


def _img_to_data_uri(path, max_side=1024, quality=82):
    """本地参考图 -> 压缩 JPEG data URI（AutoDL API 镜像传参用）。"""
    import base64 as _b64
    import io as _io
    try:
        from PIL import Image
        img = Image.open(path)
        img = img.convert("RGB")
        w, h = img.size
        scale = min(1.0, max_side / float(max(w, h)))
        if scale < 1.0:
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                             Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        mime = "image/jpeg"
    except Exception:
        with open(path, "rb") as fh:
            data = fh.read()
        mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return "data:%s;base64,%s" % (mime, _b64.b64encode(data).decode("ascii"))
