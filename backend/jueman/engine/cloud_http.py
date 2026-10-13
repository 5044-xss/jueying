"""Cloud client via direct HTTP(S) URL (no SSH).

Endpoints follow ComfyUI's HTTP API:
  GET  /system_stats          health
  POST /upload/image          multipart upload (returns name/subfolder/type)
  POST /upload/audio
  POST /prompt                submit workflow
  GET  /history/{prompt_id}   poll
  GET  /view                  download output
"""
import io
import json
import logging
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import urllib3
except ImportError:  # Old frozen exe runtime may not bundle urllib3.
    urllib3 = None


_LOGGER = logging.getLogger("cloud_http")

# --- 2026-09-09: 进程级上传去重缓存（跨 client 实例共享，TTL 防云端重启后残留） ---
_UPLOAD_CACHE = {}          # key -> (ts, result)
_UPLOAD_LOCK = threading.Lock()
_UPLOAD_TTL = 180.0         # 3 分钟内同一文件复用上传结果
def make_opener(proxy=None, direct=False):
    """构建 urllib opener。
    direct=True 强制直连（绕过系统代理与显式代理），用于代理导致连接失败时的自愈。
    proxy 为显式代理 URL；否则走系统代理（urllib 自动读取系统代理/环境变量）。
    """
    if direct:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    p = (proxy or "").strip()
    if p:
        return urllib.request.build_opener(urllib.request.ProxyHandler(
            {"http": p, "https": p}))
    return urllib.request.build_opener()


# --- 2026-09-11: 进程级 HTTP 连接池 -------------------------------------------
# 根因（cloud_error.log 2404 条，503 占 90%，其中 87% 来自 /history 轮询）：
#   原实现每次请求都 urllib.request.urlopen() -> 新建 TCP + TLS 握手。
#   仙宫云 nginx 网关对这种「高频短连接」敏感，表现为间歇性 503。
#   实测同一网关连接复用：首次 0.604s，复用后 0.047s（快 13 倍），
#   网关明确返回 Connection: keep-alive（2 次请求同一连接均 200）。
# 方案：按 host 维度共享连接池，复用长连接，直接消除短连接风暴。
# 回退：环境变量 H3_DISABLE_POOL=1 可一键退回原 urllib 路径。
_POOLS = {}
_POOLS_LOCK = threading.Lock()
_POOL_DISABLED = (os.environ.get("H3_DISABLE_POOL") or "").strip() in ("1", "true", "yes")
# 行为对齐原 urllib.request.urlopen：默认跟随 301/302/303/307/308（最多 3 跳）。
# total=False 表示连接层不自动重试 —— 重试语义仍由 CloudHTTP._open 的退避循环掌握。
if urllib3 is not None:
    _POOL_RETRY = urllib3.util.Retry(total=False, redirect=3, raise_on_redirect=False)
else:
    _POOL_RETRY = None  # Compatibility fallback uses urllib.request below.


def _pool_for_host(host, proxy=None):
    if urllib3 is None:
        return None
    key = (host, proxy or "")
    pool = _POOLS.get(key)
    if pool is not None:
        return pool
    with _POOLS_LOCK:
        pool = _POOLS.get(key)
        if pool is None:
            kw = dict(num_pools=8, maxsize=16, block=False,
                      retries=False, cert_reqs="CERT_REQUIRED")
            if proxy:
                kw["proxy"] = proxy
            pool = urllib3.PoolManager(**kw)
            _POOLS[key] = pool
        return pool


def _proxies_for(cfg):
    """云端 ComfyUI 一律直连：仙宫云为国内域名、AutoDL 走 127.0.0.1 隧道。
    系统代理是历史故障源（2026-09-09 记录：代理把 TLS 握手弄断）。
    仅当 cfg 显式配置 proxy 时才使用代理池。"""
    try:
        p = (cfg or {}).get("proxy") or ""
    except Exception:
        p = ""
    return p.strip()


def _pooled_urlopen(req, timeout=120, cfg=None):
    """用共享连接池发起请求，返回与 urllib 调用点兼容的响应对象。

    兼容性（调用方零改动）：
      resp.read() / resp.read(n) 流式、resp.status、with ... as resp
      均由 urllib3.HTTPResponse 原生支持。
    行为对齐：HTTP >= 400 时抛 urllib.error.HTTPError，保持既有
      ``except urllib.error.HTTPError as exc: exc.code`` 分支不变。
    """
    if _POOL_DISABLED or urllib3 is None:
        return urllib.request.urlopen(req, timeout=timeout)

    url = req.full_url
    parts = urllib.parse.urlsplit(url)
    host = "%s://%s" % (parts.scheme, parts.netloc)

    # 2026-09-14 root fix: never route bulk /view media through the small
    # keep-alive API pool. Measured on one xGPU instance: the same 1 MB
    # range download was far slower through the pool; independent
    # streaming sockets are required by the parallel range workers.
    if parts.path == "/view" or parts.path.startswith("/view/"):
        _proxy = _proxies_for(cfg)
        opener = make_opener(proxy=_proxy, direct=not bool(_proxy))
        return opener.open(req, timeout=timeout)

    tm = urllib3.util.Timeout(connect=timeout, read=timeout)
    pool = _pool_for_host(host, proxy=_proxies_for(cfg))

    hdrs = {k: v for k, v in (req.headers or {}).items()}
    if req.data is not None and not any(k.lower() == "content-type" for k in hdrs):
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"

    try:
        resp = pool.request(req.get_method() or "GET", url, body=req.data,
                            headers=hdrs, preload_content=False,
                            timeout=tm, retries=_POOL_RETRY)
    except Exception as exc:
        # TLS/连接层失败（常见于 urllib3 证书链与系统不一致）时，回退到
        # urllib（用系统证书）——浏览器能打开但 urllib3 报 SSL 的场景。
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except Exception:
            raise _as_urlerror(exc, url)

    if resp.status >= 400:
        code, msg, hdrs2 = resp.status, resp.reason, resp.headers
        # 关键：把响应体读出来放进 HTTPError.fp，否则上层读不到 ComfyUI 的
        # node_errors（400 校验详情），自动修复/友好提示全部失效。
        body = b""
        try:
            body = resp.read()
        except Exception:
            body = b""
        try:
            resp.release_conn()
        except Exception:
            pass
        raise urllib.error.HTTPError(url, code, msg, hdrs2, io.BytesIO(body))
    return resp


def _as_urlerror(exc, url):
    """把 urllib3 的连接层异常转成 urllib 风格异常，保持上层 except 分支可识别。"""
    name = type(exc).__name__
    if "Timeout" in name:
        return urllib.error.URLError("timed out (%s)" % exc)
    if "SSLError" in name or "SSL" in name:
        return urllib.error.URLError("SSL error: %s" % exc)
    return urllib.error.URLError("%s: %s" % (name, exc))


def http_open_read(url, data=None, headers=None, method=None, timeout=30,
                   proxy=None, cfg=None):
    """读取 URL 内容（返回响应体 bytes），网络/TLS 层自动自愈代理导致的连接失败。

    调用方无需感知代理细节：
      - 第一遍按 cfg.proxy / proxy / 系统代理请求；
      - 若失败属于 TLS/SSL/连接层错误且确实存在代理（显式或系统代理），
        自动改用直连（无代理）再试一次；直连成功则直接返回该结果。
    HTTP 层错误（如 401/404/429/5xx）不是代理问题，抛出由调用方处理。

    2026-09-09：解决「同样设置+Key 在别的软件能用、本机报 TLS/SSL 连接被关闭」——
    多数是本机代理（系统代理或软件配置的图片代理）把 toapis 的 TLS 握手弄断，
    自愈直连即可绕过，无需用户手动关代理。
    """
    real_proxy = proxy
    if real_proxy is None and cfg is not None:
        real_proxy = (cfg.get("proxy") or "").strip()
    first_err = None
    for pass_idx in range(2):
        direct = (pass_idx == 1)
        if direct:
            # 只有确实存在代理时才需要直连自愈；否则没必要
            if not real_proxy and not urllib.request.getproxies():
                break
        # 每次请求都必须新建 Request：经代理失败的 Request 会被写入隧道状态，
        # 复用会导致直连重试依旧走坏代理（2026-09-09 实测）。
        req = urllib.request.Request(
            url, data=data, method=method or ("POST" if data else "GET"))
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        opener = make_opener(proxy=real_proxy, direct=direct)
        try:
            with opener.open(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            raise exc
        except Exception as exc:
            if first_err is None:
                first_err = exc
    if first_err is not None:
        raise first_err
    raise RuntimeError("请求失败（未知网络错误）")



def _prune_upload_cache():
    """缓存超过阈值时清理过期项，防止长期运行内存膨胀。"""
    try:
        if len(_UPLOAD_CACHE) > 512:
            _now = time.time()
            for _k in [k for k, v in _UPLOAD_CACHE.items() if _now - v[0] > _UPLOAD_TTL]:
                _UPLOAD_CACHE.pop(_k, None)
    except Exception:
        pass



# --- 2026-09-05 auto-heal: ComfyUI submit 400 validation (missing model/lora) ---
_FL2VA_TURBO_PRIORITY = [
    ("8step_v1.0", 0), ("4step_v1.1", 1), ("4step_v1.0", 2),
    ("lightx2v_turbo_4step", 3), ("4step", 4), ("turbo", 5),
]


def _lora_priority(name):
    low = (name or "").lower()
    for pat, rank in _FL2VA_TURBO_PRIORITY:
        if pat in low:
            return rank
    return 99


def _basename(pathname):
    """'MiniMax-H3/foo.safetensors' -> 'foo.safetensors'"""
    return pathname.split("/", 1)[1] if "/" in (pathname or "") else pathname

def _is_comfyui_stat(raw):
    """raw 是否为 ComfyUI /system_stats 的合法 JSON（含 system 对象）。

    2026-09-06：云厂商控制台/管理页（如 https://www.xiangongyun.com/console/instance）
    对未知路径常用 HTTP 200 兜底（SPA 回退或重定向到登录页），导致 test()/ping() 只看
    状态码误判为“已连通”。真实 ComfyUI /system_stats 必然返回含 system 的 JSON，故用此
    判定区分「真连通」与「地址填错但 HTTP 2xx」。
    """
    try:
        j = json.loads(raw)
    except Exception:
        return False
    if not isinstance(j, dict):
        return False
    sys_ = j.get("system")
    if not isinstance(sys_, dict):
        return False
    # system 至少要有 comfyui_version 或 os 之一，才视为 ComfyUI
    return ("comfyui_version" in sys_) or ("os" in sys_)


def _pick_model_file_fallback(input_name, cur, valid):
    """Choose a replacement model/lora/clip/vae file name for a failed
    'value_not_in_list' input, using the server's own accepted list.

    Only returns a value when a clearly-compatible alternative exists,
    so we never silently pick a wrong-family model and hide the real cause.
    """
    if not valid:
        return None
    cur_base = _basename(str(cur)).lower()
    # 1) identical basename under a different prefix (path-layout difference)
    for v in valid:
        if _basename(v).lower() == cur_base:
            return v
    # 2) family-based fallback
    if input_name == "lora_name":
        cands = [v for v in valid if ("fl2v" in v.lower() and "turbo" in v.lower())]
        if cands:
            cands.sort(key=_lora_priority)
            return cands[0]
        return None  # no FL2VA turbo lora on cluster -> do NOT guess
    if input_name == "unet_name":
        cur_low = cur_base
        # Never cross-route between FL2VA and Ref2VA: the selected family is
        # the task family. Auto-heal may only repair path/layout differences
        # or choose another file of the same family.
        if "ref2va" in cur_low:
            cands = [v for v in valid if "ref2va" in v.lower()]
            return cands[0] if cands else None
        cands = [v for v in valid if any(k in v.lower() for k in ("fl2va", "fl2v"))]
        if cands:
            cands.sort(key=lambda v: (0 if "pruned" in v.lower() else 1, len(v)))
            return cands[0]
        cands = [v for v in valid
                 if "minimax_h3" in v.lower() and "ref2va" not in v.lower()]
        return cands[0] if cands else None
    if input_name == "clip_name":
        for kw in ("qwen3vl_32b_minimax_h3", "qwen3vl_32b", "qwen3vl", "minimax_h3"):
            for v in valid:
                if kw in v.lower():
                    return v
        return None
    if input_name == "vae_name":
        for kw in ("minimax_h3_video_vae", "minimax_h3_audio_vae", "minimax_h3"):
            for v in valid:
                if kw in v.lower():
                    return v
        return None
    if input_name == "model_name":
        # 二采 3D latent 放大模型（新镜像改名为 ..._conv_v1_bf16）。
        for kw in ("conv_v1", "latent_upscaler_3d", "latent_upscaler"):
            for v in valid:
                if kw in v.lower():
                    return v
        return None
    return None


_MISSING = object()


def _spec_default(spec):
    """从 /object_info 的字段规格里取默认值；取不到返回 _MISSING。

    spec 形如 [type, {opts...}]，type 可为字符串或候选列表（combo）。
    """
    if not isinstance(spec, list) or not spec:
        return _MISSING
    typ = spec[0]
    opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
    if "default" in opts:
        return opts["default"]
    if isinstance(typ, list) and typ:
        return typ[0]
    return _MISSING


def _conform_workflow_to_schema(workflow, object_info):
    """A1：按集群 /object_info 规整节点控件参数（跨版本自愈）。

    - 删除 schema 里不存在的“普通值”输入（保留节点连线）；
    - 补齐缺失的必填控件（用 schema 默认值 / combo 首项）。

    Returns (workflow_or_None, notes)。无可改则 (None, [])。
    """
    import copy
    if not isinstance(object_info, dict) or not object_info:
        return None, []
    wf = copy.deepcopy(workflow)
    notes = []
    changed = False
    for nid, node in wf.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or ""
        info = object_info.get(ct)
        if not isinstance(info, dict):
            continue
        spec = info.get("input") or {}
        req = spec.get("required") or {}
        opt = spec.get("optional") or {}
        known = set(req) | set(opt)
        if not known:
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for k in list(inputs.keys()):
            if k in known:
                continue
            if isinstance(inputs[k], list):
                continue  # 连线：一律保留（类型名可能是通配符）
            if "." in k:
                continue  # 动态控件输入（如 mode.scale）：schema 不单列，务必保留
            del inputs[k]
            notes.append("删除 %s.%s" % (nid, k))
            changed = True
        for k, s in req.items():
            if k in inputs:
                continue
            dv = _spec_default(s)
            if dv is _MISSING:
                continue
            inputs[k] = dv
            notes.append("补 %s.%s=%r" % (nid, k, dv))
            changed = True
    return (wf if changed else None), notes


def _heal_workflow_file_inputs(workflow, raw_body):
    """Auto-fix ComfyUI 'value_not_in_list' errors for model-file inputs
    (lora_name/unet_name/clip_name/vae_name) by re-selecting a valid value
    from the server's accepted list.

    Returns (workflow_or_None, notes_list). If nothing healable, (None, []).
    """
    import copy
    try:
        data = json.loads(raw_body)
    except Exception:
        return None, []
    node_errors = data.get("node_errors") or {}
    if not isinstance(node_errors, dict) or not node_errors:
        return None, []
    healed = copy.deepcopy(workflow)
    notes = []
    changed = False
    for node_id, err in node_errors.items():
        if not isinstance(err, dict):
            continue
        for e in (err.get("errors") or []):
            if not isinstance(e, dict) or e.get("type") != "value_not_in_list":
                continue
            extra = e.get("extra_info") or {}
            iname = extra.get("input_name")
            if not iname:
                continue
            ival = extra.get("input_config")
            valid = ival[0] if isinstance(ival, list) and ival and isinstance(ival[0], list) else []
            if not valid:
                continue
            node = healed.get(node_id)
            if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
                continue
            cur = node["inputs"].get(iname)
            if cur is None:
                continue
            picked = _pick_model_file_fallback(iname, cur, valid)
            if picked and picked != cur:
                node["inputs"][iname] = picked
                notes.append("%s.%s: %r -> %r" % (node_id, iname, cur, picked))
                changed = True
    return (healed if changed else None), notes


def _friendly_node_errors(raw_body):
    """Turn a ComfyUI validation-error body into a short readable summary."""
    try:
        data = json.loads(raw_body)
    except Exception:
        return ""
    ne = data.get("node_errors")
    if not isinstance(ne, dict) or not ne:
        return ""
    parts = []
    for node_id, err in ne.items():
        if not isinstance(err, dict):
            continue
        ct = err.get("class_type") or ""
        for e in (err.get("errors") or []):
            if not isinstance(e, dict):
                continue
            etype = e.get("type") or ""
            msg = e.get("message") or ""
            extra = e.get("extra_info") or {}
            iname = extra.get("input_name") or ""
            rv = extra.get("received_value")
            if etype == "value_not_in_list":
                parts.append("节点%s(%s)的 %s='%s' 不在云端可用列表" % (node_id, ct, iname, rv))
            elif iname:
                parts.append("节点%s(%s)的 %s: %s" % (node_id, ct, iname, msg or etype))
            else:
                parts.append("节点%s(%s): %s (%s)" % (node_id, ct, msg or etype, etype))
    return "；".join(parts)


def _diag(kind, **fields):
    """Best-effort diagnostic capture (never raise into caller)."""
    try:
        from server.services import diag
        diag.record_cloud_error(kind, **fields)
    except Exception:
        pass


def _atomic_write(path, data, retries=5):
    """Write bytes to path atomically; on Windows, if the target file is
    momentarily locked (e.g. streamed by the media player), retry os.replace.
    If it persistently fails, fall back to a versioned filename so a freshly
    generated video is never lost, and return the path actually written.
    """
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    tmp = path + ".part"
    last = None
    for _ in range(retries):
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
            return path
        except PermissionError as e:
            last = e; time.sleep(0.5)
        except OSError as e:
            last = e; time.sleep(0.5)
    try:
        ext = os.path.splitext(path)[1] or ".mp4"
        stem = os.path.splitext(path)[0]
        alt = "%s_%s_%s%s" % (stem, int(time.time()), os.getpid(), ext)
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, alt)
        return alt
    except Exception:
        with open(path, "wb") as fh:
            fh.write(data)
        return path



def _retry_after_seconds(exc, attempt, base=2.0):
    """按 HTTP 状态 + Retry-After 计算云端重试退避（429/503 更长）。"""
    try:
        code = int(getattr(exc, "code", 0) or 0)
    except Exception:
        code = 0
    delay = base * (2 ** attempt)
    if code == 429:
        delay = max(delay, 10.0)
    elif code == 503:
        delay = max(delay, 20.0)
    try:
        ra = getattr(exc, "headers", None)
        if ra is not None:
            val = ra.get("Retry-After") or ra.get("retry-after") or ""
            if val:
                try:
                    delay = max(delay, float(str(val).strip()))
                except Exception:
                    pass
    except Exception:
        pass
    return min(max(delay, 1.0), 120.0)


_TUNNELS = {}
_TUNNELS_LOCK = threading.Lock()


class SSHTunnel:
    """通过 SSH 端口转发把远程 ComfyUI 映射到本地 127.0.0.1，供 CloudHTTP 直连。"""

    def __init__(self, host, port, user, password, remote_port,
                 key_filename=None,
                 local_host="127.0.0.1", local_port=0,
                 connect_timeout=None):
        import paramiko
        self._host = host
        self._port = int(port)
        self._remote_port = int(remote_port)
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        conn_kwargs = dict(port=self._port, username=user,
                           timeout=(connect_timeout or 25), banner_timeout=60, auth_timeout=30,
                           look_for_keys=False, allow_agent=False)
        if password:
            conn_kwargs["password"] = password
        if key_filename:
            conn_kwargs["key_filename"] = key_filename
        self._client.connect(host, **conn_kwargs)
        self._transport = self._client.get_transport()
        try:
            self._transport.set_keepalive(15)
            self._transport.set_keepalive_interval(10)
        except Exception:
            pass
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind((local_host, local_port))
        self._server.listen(32)
        self.local_port = self._server.getsockname()[1]
        self._alive = True
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def alive(self):
        if not self._alive:
            return False
        if not self._transport or not self._transport.is_active():
            return False
        try:
            with socket.create_connection(("127.0.0.1", self.local_port), timeout=2):
                return True
        except OSError:
            return False

    def _accept_loop(self):
        while self._alive:
            try:
                conn, addr = self._server.accept()
            except OSError:
                break
            t = threading.Thread(target=self._forward, args=(conn, addr), daemon=True)
            t.start()

    def _forward(self, conn, addr):
        try:
            chan = self._transport.open_channel(
                "direct-tcpip", ("127.0.0.1", self._remote_port), addr)
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            return

        def pump(src, dst):
            try:
                while True:
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except Exception:
                pass
            finally:
                try:
                    dst.close()
                except Exception:
                    pass

        threading.Thread(target=pump, args=(conn, chan), daemon=True).start()
        threading.Thread(target=pump, args=(chan, conn), daemon=True).start()

    @property
    def base_url(self):
        return "http://127.0.0.1:%d" % self.local_port

    def close(self):
        self._alive = False
        try:
            self._server.close()
        except Exception:
            pass
        try:
            self._client.close()
        except Exception:
            pass


def _tunnel_key(cfg):
    return (cfg.get("ssh_host") or "", cfg.get("ssh_port") or 22,
            cfg.get("ssh_user") or "", cfg.get("comfy_port") or 6006)


def get_tunnel(cfg):
    """按集群的 SSH 信息复用隧道；配置变更后旧隧道会在下次测试时重建。"""
    key = _tunnel_key(cfg)
    with _TUNNELS_LOCK:
        t = _TUNNELS.get(key)
        if t is not None and not t.alive():
            try:
                t.close()
            except Exception:
                pass
            _TUNNELS.pop(key, None)
            t = None
        if t is not None:
            return t
    # 2026-08-23 加固：首次建隧道失败（仙宫云/AutoDL 网关瞬时限流 10054 banner reset）
    # 直接抛会让提交/测试误报失败；重试 4 次（退避 1/2/3/4s）自愈。
    t = None
    last = None
    tcp_ok = False  # 最近一次端口探测是否可连（区分“实例未开机”与“网关限流”）
    for _i in range(4):
        try:
            # 先快速探测端口：可连但 SSH 握手失败=网关限流/未就绪；
            # 连不上=实例未开机/已关机/SSH 端口已变。避免误导用户一直等。
            try:
                with socket.create_connection(
                        (str(cfg["ssh_host"]).strip(),
                         int(cfg.get("ssh_port") or 22)), timeout=8):
                    tcp_ok = True
            except OSError:
                tcp_ok = False
            t = SSHTunnel(cfg["ssh_host"], cfg.get("ssh_port") or 22,
                          cfg.get("ssh_user") or "root",
                          cfg.get("ssh_pass") or "",
                          cfg.get("comfy_port") or 6006)
            break
        except Exception as exc:
            last = exc
            time.sleep(1 + _i)
    if t is None:
        if tcp_ok:
            raise RuntimeError(
                "云端 SSH 网关限流或实例未就绪（端口可连但 SSH 握手失败，"
                "通常是短时间内请求过于频繁，或实例刚开机还在初始化）："
                "请等待 1-2 分钟再试；若实例重启过，请到算力控制台复制最新 "
                "SSH 登录指令并更新端口（" + str(last)[:80] + "）")
        raise RuntimeError(
            "无法连接云端实例（实例未启动/已关机，或 SSH 端口已变化）："
            "请先在算力控制台启动实例；实例重启后 SSH 端口会变，请复制最新 "
            "ssh -p 端口 root@主机 登录指令并更新到设置（" + str(last)[:80] + "）")
    # 2026-08-24 根因修复：此前 `_TUNNELS[key]=t; return t` 被误放进
    # 异常分支的 raise 后面（死代码），成功建隧道后函数隐式返回 None，
    # 上层 make_client 取 tunnel.base_url 直接崩（仙宫云/SSH 集群全部报错）。
    _TUNNELS[key] = t
    return t


def close_tunnel(cfg):
    key = _tunnel_key(cfg)
    with _TUNNELS_LOCK:
        t = _TUNNELS.pop(key, None)
    if t is not None:
        t.close()



def parse_ssh_login_block(text):
    """解析仙宫云/AutoDL 控制台复制的整段「SSH 登录信息」，返回 host/port/user/password/comfy_port。"""
    s = str(text or "").strip()
    out = {"host": "", "port": 0, "user": "", "password": "", "comfy_port": 0}
    if not s:
        return out
    def grab(label):
        m = re.search(re.escape(label) + r"\s*[:：]?\s*([^\r\n]+)", s)
        if m:
            v = m.group(1).strip()
            if v and not re.match(r"^(端口|用户|密码|连接|主机)", v):
                return v
        return ""
    out["host"] = grab("连接主机") or grab("主机") or grab("host")
    out["user"] = grab("用户") or grab("账号") or grab("user")
    out["password"] = grab("密码") or grab("password")
    pm = grab("端口")
    if pm:
        try:
            out["port"] = int(pm)
        except ValueError:
            pass
    m = re.search(r"ssh\s+-p\s+(\d+)\s+([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)", s)
    if m:
        if not out["port"]:
            out["port"] = int(m.group(1))
        if not out["user"]:
            out["user"] = m.group(2)
        if not out["host"]:
            out["host"] = m.group(3)
    if not out["host"]:
        m = re.search(r"([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)(?::(\d+))?", s)
        if m:
            if not out["user"]:
                out["user"] = m.group(1)
            out["host"] = m.group(2)
            if not out["port"] and m.group(3):
                out["port"] = int(m.group(3))
    return out


def _parse_ssh_fields(cfg):
    """兼容 AutoDL 控制台复制的 SSH 连接串格式（2026-08-19）：
    用户可能把 'ssh -p 36726 root@host' 整串粘进 ssh_user / ssh_host，
    或把 host 填成 'host:36726'。统一解析出 (host, port, user)。
    2026-08-27：识别控制台整段「SSH 登录信息」块（含中文标签，自动取主机/端口/账号）。
    """
    raw_host = str(cfg.get("ssh_host") or "").strip()
    raw_user = str(cfg.get("ssh_user") or "root").strip() or "root"
    blob = raw_host + " " + raw_user
    if ("连接主机" in blob) or ("**SSH" in blob) or ("\n" in blob) or ("密码" in blob):
        try:
            info = parse_ssh_login_block(raw_host + "\n" + raw_user)
            if info.get("host"):
                return info["host"], int(info.get("port") or 22), (info.get("user") or "root")
        except Exception:
            pass
    host = raw_host
    try:
        port = int(cfg.get("ssh_port") or 22)
    except (TypeError, ValueError):
        port = 22
    user = raw_user
    combined = ""
    if user.startswith("ssh ") or user.startswith("ssh\t"):
        combined = user
    elif host.startswith("ssh ") or host.startswith("ssh\t"):
        combined = host
    if combined:
        m = re.search(r"-p\s+(\d+)", combined)
        if m:
            port = int(m.group(1))
        m = re.search(r"([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)", combined)
        if m:
            user, host = m.group(1), m.group(2)
        else:
            words = combined.split()
            if words:
                last = words[-1]
                if last and last.lower() not in ("ssh", "-p") and not re.match(r"^\d+$", last):
                    user = last
    elif "@" in user and not re.match(r"^[A-Za-z0-9_.-]+$", user):
        u, h = user.rsplit("@", 1)
        user, host = u, h
    if "@" in host and host.count("@") == 1:
        u, h = host.rsplit("@", 1)
        user, host = u, h
    if ":" in host and host.count(":") == 1:
        h, p = host.rsplit(":", 1)
        try:
            port = int(p)
            host = h
        except ValueError:
            pass
    return host.strip(), port, user.strip()



def friendly_error(exc, context="cloud"):
    """把底层异常/HTTP 报错翻译成用户能读懂的中文提示（2026-08-18）。
    覆盖：网络中断/超时/拒绝连接/域名解析、503/502、额度不足、Key 无效、限流。

    context="cloud"：云集群/算力实例（SSH/隧道/ComfyUI），保留集群措辞；
    context="api"：第三方远程接口（toapis/dashscope/DeepSeek 等图片/文本 API），
    与云端无任何关系，网络/连接类报错一律用“远程接口”措辞，绝不误导用户去查算力集群。
    """
    s = str(exc) or ""
    # HTTPError 只带状态码，读响应体里的真实原因（如 DeepSeek 400 Model Not Exist、
    # dashscope 欠费返回体），避免"400 Bad Request"被吞成"操作失败"
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = exc.read().decode("utf-8", "replace")[:500]
            if body and body.strip():
                try:
                    j = json.loads(body)
                    body = str(j.get("error") or j.get("message")
                               or j.get("detail") or j)[:300]
                except Exception:
                    body = body[:300]
                s = "%s %s" % (s, body)
        except Exception:
            pass
    low = s.lower()
    is_cloud = (context == "cloud")
    # 2026-09-09: AI 限流识别——DeepSeek/千问等文本/图片 API 报错会带这些特征词，
    # 即便 generate 接口兜底没传 context，也能正确区分「AI 服务」与「云端」的限流措辞。
    _llm_429 = ("短时间请求过多" in s or "每分钟请求" in s
                or "字数超限" in s)
    # 2026-09-09: 提示词与素材不匹配——直接透传明确操作提示（前端会高亮「重新生成提示词」按钮），
    # 不要被通用模板二次包装成「操作失败」（用户看不到到底该点哪个按钮）。
    if ("提示词与素材不匹配" in s or "提示词引用了" in s
            or "没有声明任何 <Picture>" in s or "本段仅上传" in s):
        return s.strip()[:300]
    if "云端提交失败" in s:
        return s.strip()[:300]
    # 2026-09-09: 中文限流短语本身不含 429 数字（DeepSeek/千问返回
    # “短时间请求过多/每分钟请求/字数超限”），若只在下方 429 分支判断会漏掉，
    # 直接落到「操作失败」兜底误导用户。这里独立命中并归到「AI 服务」。
    if ("短时间请求过多" in s or "每分钟请求" in s or "字数超限" in s):
        return "AI 服务请求过于频繁（限流），请稍等片刻再试"
    # 2026-08-27：submit() 已把云端原始返回拼进错误（"；云端返回：..."），
    # 直接透传，避免"您的实例可能正在启动中"被 502/503 模板吞成"服务过载"误导用户。
    if "云端返回" in s:
        return s.strip()[:300]
    # 已翻译好的明确中文提示（集群/实例/启动/重启/过载/网关类）直接透传，
    # 避免被泛化成"操作失败"
    if ("集群" in s or "实例" in s or "算力" in s
            or "未配置" in s or "不可达" in s or "启动" in s
            or "重启" in s or "停机" in s or "维护" in s
            or "过载" in s or "网关" in s):
        return s.strip()[:300]
    # AutoDL API 镜像已转好的明确中文提示（并发上限/Token 无效/平台服务异常等）
    # 直接透传，避免被下方通用 429/503 模板二次包装成"请求过于频繁"而丢失真实原因（2026-09-06）。
    if "autodl api" in low:
        return s.strip()[:300]
    # 平台返回的 JSON 字段（toapis / dashscope 等）
    if ("quota_not_enough" in low or "insufficient_quota" in low
            or "insufficient" in low or "arrear" in low
            or "balance" in low or "余额" in s or "额度" in s
            or "credit" in low and "limit" in low):
        return "余额或额度不足，请到对应平台充值/购买额度后重试"
    if ("authentication failed" in low or "permission denied" in low
            or "publickey" in low or "host key" in low
            or "channel open error" in low or "ssh" in low and "auth" in low):
        return "SSH 登录失败（账号/密码/端口不对或密钥无效），请检查算力集群的 SSH 设置"
    if ("invalid_api_key" in low or "invalid api key" in low
            or "unauthorized" in low):
        return "API Key 无效或无权限，请检查设置里的 Key 是否正确"
    if ("rate_limit" in low or "too many requests" in low or "429" in low):
        if _llm_429 or not is_cloud:
            return "AI 服务请求过于频繁（限流），请稍等片刻再试"
        return "云端请求过于频繁（限流），请稍等片刻再试"
    if ("model_not_found" in low or "model not found" in low
            or "model does not exist" in low or "model not exist" in low):
        return "模型名称不存在或无权访问，请检查设置的模型名"
    if ("llm 返回空内容" in s or "返回空内容" in s):
        return "AI 模型没有返回内容（可能是余额不足或模型名不对），请检查设置后重试"
    if ("winerror 10054" in low or "connection reset" in low
            or "远程主机强迫关闭" in low or "远程主机强制关闭" in low):
        if not is_cloud:
            return ("远程接口连接被中断（网络波动或接口服务异常，或被对方限流）："
                    "软件已自动重试；若持续出现，请稍后重试或确认本机网络/代理设置")
        return ("云端连接被限流或中断（短时间内请求过于频繁，或云端正在重启）："
                "软件已自动降低请求频率并重连，请稍后重试；任务不会丢失，"
                "完成后会自动回传")

    # 2026-09-06: TLS/SSL 握手或传输阶段被对端异常关闭（_ssl.c: ... EOF occurred in
    # violation of protocol / RemoteDisconnected），常由云端实例重启、网关限流或网络波动引起。
    # 之前落到兜底"操作失败，请检查网络/配置后重试"，误导用户以为只是配置问题。
    if ("_ssl.c" in low or "eof occurred in violation of protocol" in low
            or "remote disconnected" in low or "remotedisconnected" in low
            or "remote end closed connection" in low or "bad eof" in low
            or ("ssl" in low and ("eof" in low or "handshake" in low or "closed" in low))
            or ("tls" in low and ("eof" in low or "handshake" in low))):
        if not is_cloud:
            return ("远程接口服务器的加密连接被对方异常关闭（TLS/SSL 握手或传输中断）："
                    "通常是接口服务波动、被限流或本机网络波动导致，软件已自动重试；"
                    "若持续出现，请稍后重试，或确认接口地址/本机网络（含代理）后再测试")
        return ("与云端/服务器的加密连接被对方异常关闭（TLS/SSL 握手或传输中断）："
                "通常是云端实例正在重启、网关限流或网络波动导致，软件已自动重试；"
                "若持续出现，请稍后重试，或到算力集群设置里确认实例已开机、URL 直连地址仍有效")
    if ("winerror 10060" in low or "timed out" in low
            or "timeout" in low or "超时" in s):
        if not is_cloud:
            return "远程接口连接超时，请检查网络后重试（或确认接口地址可达）"
        return "云端连接超时，请检查网络后重试（或确认实例已开机、地址有效）"
    if ("winerror 10061" in low or "connection refused" in low
            or "unable to connect to port" in low
            or "无法连接" in s and "端口" in s):
        if not is_cloud:
            return "无法连接接口服务（连接被拒绝，可能地址有误或服务未就绪），请检查接口地址后重试"
        # 2026-08-22：回显端口 + AutoDL 端口变化指引（实例重启后 SSH 端口会变）
        m = re.search(r"port\s+(\d+)", low)
        port_hint = ("端口 %s " % m.group(1)) if m else ""
        return ("无法连接目标服务（%s被拒绝，可能未开机、端口已变化或地址有误）。"
                "AutoDL 实例重启后 SSH 端口会变：请到 AutoDL 控制台『实例-登录指令』"
                "复制最新 ssh -p 端口 root@主机 命令，把端口填入软件算力设置后重新测试。"
                % port_hint)
    if ("11001" in low or "getaddrinfo" in low
            or "name or service not known" in low or "域名" in s):
        return "无法解析服务器地址，请检查接口地址/域名是否正确"
    if ("unknown url type" in low or "no host given" in low
            or "缺少 http" in s or "缺少 https" in s):
        if not is_cloud:
            return "接口地址缺少 http:// 或 https:// 前缀，请检查接口地址格式"
        return ("接口地址缺少 http:// 或 https:// 前缀（可能是没写协议头或格式错误）。"
                "请在算力集群设置里填写完整 URL 直连地址，如 https://xxx.com:8188")
    if "503" in low:
        if not is_cloud:
            return "接口服务过载（503）：接口平台可能正在维护或限流，软件已自动降低查询频率，请稍后重试"
        return ("云端服务过载（503）：并发请求过多或云端资源不足，"
                "软件已自动降低查询频率，请稍后重试；任务若已在云端生成会自动回传")
    if "502" in low:
        if not is_cloud:
            return "接口网关错误（502）：接口平台可能正在重启或网络波动，软件已自动重试，请稍后再试"
        return ("云端网关错误（502）：云端可能正在重启或网络波动，"
                "软件已自动重试，请稍后再试；任务若已提交请勿重复点击生成")
    if "402" in low or "insufficient balance" in low:
        return ("AI 模型余额不足（402）：请到对应平台充值，或更换有额度的 API Key 后重试")
    if ("quota_not_enough" in low or "insufficient" in low
            or "arrear" in low or "余额" in s or "额度" in s):
        return "API 余额或额度不足，请到对应平台充值/购买额度后重试"
    if "401" in low or "unauthorized" in low:
        return "API Key 无效（401），请检查设置里的 Key 是否正确"
    if "403" in low or "forbidden" in low:
        # 2026-08-29：403 不代表「余额不足」（无效 key 是 401，余额不足多为 402/insufficient_quota）。
        # 读真实响应体：命中余额/额度才提示充值，命中内容审核才提示改词，否则给出通用且真实的原因。
        if ("余额" in s or "额度" in s or "quota" in low or "insufficient" in low
                or "balance" in low or "arrear" in low):
            return "余额或额度不足，请到对应平台充值或购买额度后重试"
        if any(k in s for k in ("内容审核", "审核不通过", "敏感内容", "sensitive", "content policy", "risk")):
            return "图片请求被平台内容安全审核拦截（Forbidden 403），请调整提示词后重试"
        return ("请求被平台拒绝（Forbidden 403）：可能是账户对该模型无权限、接口地址(base_url)异常，或内容审核拦截。若确认余额充足仍报错，请检查设置里的接口地址与 Key")
    if "429" in low or "rate limit" in low:
        if _llm_429 or not is_cloud:
            return "AI 服务请求过于频繁（限流），请稍等片刻再试"
        return "云端请求过于频繁（限流），请稍等片刻再试"
    if "database is locked" in low or "database is busy" in low:
        return "本地数据文件正被占用/写入冲突，请稍后重试；若持续出现请重启软件"
    if "数据库忙" in s or "数据库" in s and ("忙" in s or "锁" in s):
        return s.strip()[:200]
    if ("jsondecodeerror" in low or "expecting value" in low
            or "invalid json" in low or "unexpected token" in low
            or "no json object" in low):
        return "服务返回内容不是有效数据（可能被网关拦截或接口异常），请稍后重试；若持续出现请检查设置的接口地址"
    if "autodl api" in low or ("token" in low and ("无效" in s or "填写" in s)):
        return s.strip()[:300]
    # 2026-08-24：授权/激活/剧本分析等明确原因直接透传，防止被上层误判成云端错误
    if any(k in s for k in ("授权", "激活", "序列号", "剧本分析", "分镜生成",
                            "提示词生成", "语音识别", "质检", "DeepSeek", "千问",
                            "模型名", "模型不存在", "请先")):
        return s.strip()[:300]
    # 2026-08-28：数据类型类异常（分镜字段被解析成 dict 等）——不要泛化成
    # "操作失败"，直接提示是分镜/数据格式问题，并给出可操作的修复方向。
    if ("expected str instance" in low or "sequence item" in low
            or "unsupported operand" in low or "must be str" in low
            or "expected string" in low or "object has no attribute" in low):
        return ("该段分镜/数据格式异常（某个字段类型不对，可能是分镜被手动改坏、"
                "拷贝损坏或解析异常）：请重新分析/修复该段分镜后重试；"
                "若持续出现，请在剧本页重新生成分镜")
    # 兜底：把原始异常拼进提示，绝不吞掉真实原因（2026-08-24 用户要求）
    raw = (s or "").strip()[:200]
    if raw:
        return "操作失败，请检查网络/配置后重试（原因：%s）" % raw
    return "操作失败，请检查网络/配置后重试"


def _derive_ssh_host(cfg):
    """从 URL 推导 xgpu SSH 主机名（2026-08-27 起不再自动使用）。
    https://<id>-8188.container.x-gpu.com  ->  <id>.ssh.x-gpu.com
    端口由 xgpu 控制台自定义，无法从 URL 推导，见 _ssh_configured。
    """
    url = str(cfg.get("base_url") or "").strip()
    m = re.match(r"https?://([A-Za-z0-9_.-]+)", url)
    if not m:
        return ""
    host = m.group(1)
    if not host.endswith(".container.x-gpu.com"):
        return ""
    head = host.split(".", 1)[0]
    mm = re.match(r"^(.+)-\d+$", head)
    if mm:
        return mm.group(1) + ".ssh.x-gpu.com"
    return ""


def _ssh_configured(cfg):
    """SSH tunnel is used only when an explicit SSH host is configured.
    A URL direct connection is used otherwise. We deliberately do NOT auto-
    derive the SSH host from the URL, because the xgpu SSH port is a custom
    port shown by the xgpu console and cannot be derived from the URL; a
    wrong port would silently fail the tunnel (2026-08-27).
    """
    return bool(str(cfg.get("ssh_host") or "").strip())

def make_client(cfg):
    """按集群类型返回 CloudHTTP：
    - 仙宫云/直连（type 缺省或 xgpu）：**base_url 非空优先走 URL 直连**（最稳定），
      即使历史配置残留 ssh_host 也以 URL 为准；
    - 仅当 base_url 为空 且 显式配置 ssh_host 时，才建 SSH 隧道连本地端口；
    - AutoDL API 镜像（type=autodl_api）：走 autodl.art ComfyUI API，
      POST workflow 提交 + GET result/{task_id} 轮询 + 短时效 URL 下载。
    - 两者皆空则报错提示补充连接地址。
    """
    ctype = str(cfg.get("type") or "xgpu").strip().lower()
    if ctype == "autodl_api":
        return AutoDLApiClient(cfg)
    host = str(cfg.get("ssh_host") or "").strip()
    user = str(cfg.get("ssh_user") or "root").strip() or "root"
    base_url = str(cfg.get("base_url") or "").strip()
    if base_url:
        # URL 直连优先：即使残留 ssh_host，只要填了 base_url 就走直连。
        copy = dict(cfg)
        copy["base_url"] = base_url
        copy.pop("_tunnel", None)
        return CloudHTTP(copy)
    if _ssh_configured(cfg) and user and host:
        # 仅在未提供 base_url 且显式配置 SSH 时才走隧道。
        copy = dict(cfg)
        h, p, u = _parse_ssh_fields(copy)
        copy["ssh_host"], copy["ssh_port"], copy["ssh_user"] = h, p, u
        tunnel = get_tunnel(copy)
        copy["base_url"] = tunnel.base_url
        copy["_tunnel"] = tunnel
        return CloudHTTP(copy)
    raise RuntimeError("集群「%s」未配置连接地址；请填写 URL 直连地址或 SSH 连接命令。" % cfg.get("name", ""))


class CloudHTTP:
    def __init__(self, cfg):
        self.cfg = cfg
        self.base = cfg["base_url"].rstrip("/")
        self._tunnel = cfg.get("_tunnel")
        self.token = cfg.get("token", "")
        # 上传去重缓存：key=(集群,路径,大小,mtime_ns) -> 云端 {name,subfolder,type}
        self._upload_cache = {}
        # 2026-10-13：/object_info 缓存 + 每个 client 只做一次 schema 规整（A1）。
        self._object_info = None
        self._conform_done = False

    def _upkey(self, local_path):
        try:
            st = os.stat(local_path)
            size = st.st_size
            mtime = int(st.st_mtime_ns)
        except OSError:
            return None
        cluster = (self.cfg.get("base_url") or "") + "|" + \
                  str(self.cfg.get("ssh_host") or "")
        return (cluster, os.path.abspath(local_path), size, mtime)

    def _resolve(self):
        # 直连模式（base_url 优先，self._tunnel 为 None）绝不重建 SSH 隧道；
        # 只有通过隧道构造的客户端才在重试时重建隧道，防止直连后被切回隧道。
        if self._tunnel is not None and self.cfg.get("ssh_host") and self.cfg.get("ssh_user"):
            t = get_tunnel(self.cfg)
            if t is not self._tunnel:
                self._tunnel = t
                self.base = t.base_url
        return self.base

    def _open(self, method, path, data=None, headers=None, timeout=120,
              attempts=None):
        if not attempts or attempts < 1:
            attempts = 5
        retry_on_http = not (method == "POST" and path.startswith("/prompt"))
        last = None
        for attempt in range(attempts):  # 2026-08-23 加固：5 次，退避 2/4/6/8s
            try:
                base = self._resolve()  # 隧道建立失败（10054 banner reset）也进入重试
                req = urllib.request.Request(base + path, data=data, method=method)
                for k, v in (headers or {}).items():
                    req.add_header(k, v)
                return _pooled_urlopen(req, timeout=timeout, cfg=self.cfg)
            except urllib.error.HTTPError as exc:
                # /prompt 只在 429/503（未受理）时重试；502/504 可能已受理，避免重复提交
                if exc.code in (429, 502, 503, 504) and attempt < attempts - 1 and (
                        retry_on_http or exc.code in (429, 503)):
                    last = exc
                    # 2026-08-23：第一次重试先不重建隧道（瞬时抖动可自愈），
                    # 后续才 close+重建，退避递增，避免频繁重连触发 SSH 网关限流。
                    if attempt >= 1:
                        try:
                            close_tunnel(self.cfg)
                        except Exception:
                            pass
                    _delay = _retry_after_seconds(exc, attempt)
                    _LOGGER.warning(
                        "云端 HTTP %s 第 %d/5 次重试（%.1fs）：%s",
                        exc.code, attempt + 1, _delay, "等待平台恢复")
                    time.sleep(_delay)
                    continue
                raise
            except Exception as exc:
                # 隧道握手/连接被重置/超时等：同样重试并重建隧道
                last = exc
                if attempt < attempts - 1:
                    if attempt >= 1:
                        try:
                            close_tunnel(self.cfg)
                        except Exception:
                            pass
                    time.sleep(2 + 2 * attempt)
                    continue
                raise
        _diag("open_retry_exhausted", cloud=self.cfg.get("name") or "?",
              ctype=self.cfg.get("type") or "",
              base_url=self.cfg.get("base_url") or "",
              path=path, attempts=attempts,
              exception="%s: %s" % (type(last).__name__, last))
        raise last if last is not None else RuntimeError("request failed")

    def _headers(self):
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        return h

    def test(self):
        try:
            with self._open("GET", "/system_stats", timeout=20, attempts=1) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except Exception as exc:
            try:
                from server.services import diag
                diag.record_cloud_error("test", cloud=self.cfg.get("name") or "?",
                                       ctype=self.cfg.get("type") or "",
                                       base_url=self.cfg.get("base_url") or "",
                                       exception="%s: %s" % (type(exc).__name__, exc))
            except Exception:
                pass
            return False, friendly_error(exc)
        if _is_comfyui_stat(raw):
            return True, raw[:200]
        # 2026-09-06：HTTP 2xx 但返回的不是 ComfyUI JSON —— 多为填了控制台/网页地址
        return False, ("连接返回了内容，但不是 ComfyUI 数据（疑似填了云厂商的控制台或网页地址）。"
                       "请填写「浏览器里能打开 ComfyUI 页面」的地址，形如 "
                       "https://<实例ID>-8188.container.x-gpu.com/ ；"
                       "不要填 https://www.xiangongyun.com/console/instance 这类管理页地址")

    def object_info(self, timeout=60):
        """返回集群已安装节点类型字典（探测二采等自定义节点是否可用）。"""
        with self._open("GET", "/object_info", timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))

    def upload(self, local_path, kind="image"):
        """Upload image/audio via ComfyUI /upload/image (audio also uses it).
        2026-08-22：同一文件内容未变时复用上次上传结果，不再重复上传。
        2026-09-09：上传去重收敛为进程级共享缓存（带 TTL），解决 _pick_cloud 每次
        新建 client 使 _upload_cache 失效、同一素材跨段被反复上传。"""
        key = self._upkey(local_path)
        now = time.time()
        if key is not None:
            with _UPLOAD_LOCK:
                _hit = _UPLOAD_CACHE.get(key)
                if _hit and (now - _hit[0]) < _UPLOAD_TTL:
                    return dict(_hit[1])
        endpoint = "/upload/image"
        field = "image"
        boundary = "----h3studio" + str(os.getpid())
        fname = os.path.basename(local_path)
        with open(local_path, "rb") as fh:
            fdata = fh.read()
        body = (
            ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
             "Content-Type: application/octet-stream\r\n\r\n" % (boundary, field, fname)).encode()
            + fdata + ("\r\n--%s--\r\n" % boundary).encode()
        )
        headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        with self._open("POST", endpoint, data=body, headers=headers, timeout=300, attempts=1) as resp:
            result = json.loads(resp.read().decode("utf-8", "replace"))
        if key is not None:
            with _UPLOAD_LOCK:
                _UPLOAD_CACHE[key] = (now, dict(result))
                self._upload_cache[key] = dict(result)
                _prune_upload_cache()
        return result

    def _conform(self, workflow):
        """A1：提交前按 /object_info 规整一次节点参数（每 client 只做一次）。"""
        if self._conform_done:
            return workflow
        self._conform_done = True
        if not self.cfg.get("step_probe", True):
            return workflow
        try:
            oi = self._object_info
            if oi is None:
                oi = self.object_info(timeout=30)
                self._object_info = oi if isinstance(oi, dict) else {}
        except Exception:
            self._object_info = {}
            return workflow
        if not self._object_info:
            return workflow
        try:
            healed, notes = _conform_workflow_to_schema(workflow, self._object_info)
        except Exception:
            return workflow
        if healed is not None:
            _LOGGER.warning("云端参数已按 /object_info 规整：%s", "；".join(notes[:20]))
            return healed
        return workflow

    def submit(self, workflow, _heal_depth=0):
        workflow = self._conform(workflow)
        try:
            with self._open("POST", "/prompt",
                            data=json.dumps({"prompt": workflow}).encode(),
                            headers=self._headers(), timeout=120, attempts=1) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            # 2026-09-05 auto-heal: 400 validation due to missing model/lora on cluster.
            if exc.code == 400:
                healed, notes = _heal_workflow_file_inputs(workflow, detail)
                if healed is not None and _heal_depth < 3:
                    _LOGGER.warning(
                        "云端 %s 模型/加速文件缺失，已自动切换到集群可用项：%s",
                        self.cfg.get("name") or "?", "；".join(notes))
                    try:
                        from server.services import diag
                        diag.record_cloud_error(
                            "submit_heal", cloud=self.cfg.get("name") or "?",
                            ctype=self.cfg.get("type") or "",
                            base_url=self.cfg.get("base_url") or "",
                            raw_body=detail[:8000], notes=notes)
                    except Exception:
                        pass
                    return self.submit(healed, _heal_depth + 1)
            full_body = detail
            detail = detail[:800]
            _hint = {429: "云端请求过于频繁（429）：软件已自动降低频率并重试，请稍后再试",
                     502: "云端网关错误（502）：云端可能正在重启或网络波动，软件已自动重试",
                     503: "云端服务过载（503）：并发请求过多或资源不足，软件已自动降低频率",
                     504: "云端响应超时（504）：任务可能已在云端运行"}.get(
                         exc.code, "HTTP %s" % exc.code)
            raw = (detail or "").strip()
            _friendly = _friendly_node_errors(full_body)
            if _friendly:
                _hint = "云端节点校验失败：%s" % _friendly
            elif raw:
                raw = raw[:160]
                _hint = "%s；云端返回：%s" % (_hint, raw)
            try:
                from server.services import diag
                diag.record_cloud_error(
                    "submit", cloud=self.cfg.get("name") or "?",
                    ctype=self.cfg.get("type") or "",
                    base_url=self.cfg.get("base_url") or "",
                    http_code=exc.code, raw_body=full_body[:4000],
                    exception="%s: %s" % (type(exc).__name__, exc))
            except Exception:
                pass
            raise RuntimeError("云端「%s」提交失败：%s，请稍后重试"
                               % (self.cfg.get("name") or "?", _hint)) from exc
        except Exception as exc:
            _diag("submit", cloud=self.cfg.get("name") or "?",
                  ctype=self.cfg.get("type") or "",
                  base_url=self.cfg.get("base_url") or "",
                  exception="%s: %s" % (type(exc).__name__, exc))
            raise

    def history(self, prompt_id, attempts=None, timeout=30):
        try:
            with self._open("GET", "/history/" + prompt_id, timeout=timeout, attempts=attempts) as resp:
                return json.loads(resp.read().decode("utf-8", "replace")).get(prompt_id, {})
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                _diag("history", cloud=self.cfg.get("name") or "?",
                      ctype=self.cfg.get("type") or "",
                      base_url=self.cfg.get("base_url") or "",
                      prompt_id=prompt_id,
                      exception="HTTP %s: %s" % (exc.code, exc))
            return {} if exc.code == 404 else {"error": str(exc)}
        except Exception as exc:
            _diag("history", cloud=self.cfg.get("name") or "?",
                  ctype=self.cfg.get("type") or "",
                  base_url=self.cfg.get("base_url") or "",
                  prompt_id=prompt_id,
                  exception="%s: %s" % (type(exc).__name__, exc))
            return {}

    def queue(self, attempts=None, timeout=30):
        try:
            with self._open("GET", "/queue", timeout=timeout, attempts=attempts) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except Exception as exc:
            _diag("queue", cloud=self.cfg.get("name") or "?",
                  ctype=self.cfg.get("type") or "",
                  base_url=self.cfg.get("base_url") or "",
                  exception="%s: %s" % (type(exc).__name__, exc))
            return {}

    def ping(self):
        """快速探测集群是否可用（提交前用，防止把任务提交到离线集群后卡死）。
        2026-09-06：不再只看 HTTP 200，必须返回 ComfyUI /system_stats JSON，否则视为未连通。
        失败原因写入 self._ping_info，供上层给出更精准提示（如「地址填了控制台/网页」）。
        """
        self._ping_info = ""
        try:
            with self._open("GET", "/system_stats", timeout=15, attempts=1) as resp:
                raw = resp.read().decode("utf-8", "replace")
                if _is_comfyui_stat(raw):
                    return True
                self._ping_info = ("集群地址返回的不是 ComfyUI 数据（疑似填了云厂商控制台/网页地址）。"
                                   "请填「浏览器里能打开 ComfyUI 页面」的地址，形如 "
                                   "https://<实例ID>-8188.container.x-gpu.com/ ；"
                                   "不要填 https://www.xiangongyun.com/console/instance 这类管理页地址")
                return False
        except Exception as exc:
            self._ping_info = friendly_error(exc)
            return False

    def interrupt(self):
        """中断当前正在执行的生成（ComfyUI /interrupt）。"""
        try:
            with self._open("POST", "/interrupt", data=b"",
                            headers=self._headers(), timeout=30) as resp:
                return resp.status == 200
        except Exception:
            return False

    def queue_delete(self, prompt_ids):
        """从云端队列删除指定任务（ComfyUI /queue {delete: [id]}）。"""
        try:
            with self._open("POST", "/queue",
                            data=json.dumps({"delete": list(prompt_ids)}).encode("utf-8"),
                            headers=self._headers(), timeout=30) as resp:
                return resp.status == 200
        except Exception:
            return False

    def _download_part_path(self, local_path):
        return "%s.part.%d.%d.%d" % (
            local_path, os.getpid(), threading.get_ident(), int(time.time() * 1000))

    def _probe_range_total(self, path):
        """Return total size when the ComfyUI /view endpoint supports HTTP Range."""
        with self._open("GET", path, headers={"Range": "bytes=0-0"},
                        timeout=12, attempts=1) as resp:
            try:
                status = int(getattr(resp, "status", 200) or 200)
            except Exception:
                status = 200
            if status != 206:
                return None
            content_range = resp.headers.get("Content-Range") or ""
            m = re.search(r"/(\d+)\s*$", content_range)
            if not m:
                return None
            total = int(m.group(1))
            return total if total > 0 else None

    def _finish_download_part(self, part, local_path):
        """Atomically publish a completed part file, with Windows lock fallback."""
        try:
            with open(part, "r+b") as fh:
                fh.flush()
                os.fsync(fh.fileno())
        except Exception:
            pass
        last = None
        for _ in range(5):
            try:
                os.replace(part, local_path)
                return local_path
            except OSError as exc:
                last = exc
                time.sleep(0.4)
        try:
            stem, ext = os.path.splitext(local_path)
            alt = "%s_%d_%d%s" % (stem, int(time.time()), os.getpid(), ext or ".mp4")
            os.replace(part, alt)
            return alt
        except Exception:
            with open(part, "rb") as src, open(local_path, "wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
            try:
                os.remove(part)
            except OSError:
                pass
            return local_path

    def _download_stream(self, path, local_path, progress=None):
        """Single-connection fallback: stream directly to disk, never RAM."""
        part = self._download_part_path(local_path)
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        last = None
        for attempt in range(4):
            done = 0
            total = None
            try:
                with self._open("GET", path, timeout=600, attempts=1) as resp:
                    try:
                        total = int(resp.headers.get("Content-Length") or 0) or None
                    except Exception:
                        total = None
                    with open(part, "wb") as fh:
                        last_report = 0
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            fh.write(chunk)
                            done += len(chunk)
                            if progress and (done - last_report >= 1024 * 1024 or
                                             (total and done >= total)):
                                last_report = done
                                try:
                                    progress(done, total or done)
                                except Exception:
                                    pass
                        fh.flush()
                        os.fsync(fh.fileno())
                if total and done != total:
                    raise RuntimeError("download incomplete: got %d bytes, expected %d" %
                                       (done, total))
                if progress:
                    try:
                        progress(done, total or done)
                    except Exception:
                        pass
                return self._finish_download_part(part, local_path)
            except Exception as exc:
                last = exc
                try:
                    if os.path.exists(part):
                        os.remove(part)
                except OSError:
                    pass
                if attempt < 3:
                    time.sleep(1.0 + attempt)
        raise last

    def _download_parallel_ranges(self, path, local_path, total, progress=None):
        """Download disjoint byte ranges concurrently and write at file offsets."""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        try:
            workers = int(os.environ.get("H3_DOWNLOAD_WORKERS") or "4")
        except Exception:
            workers = 4
        workers = max(1, min(8, workers))
        if total < 512 * 1024 or workers <= 1:
            return self._download_stream(path, local_path, progress)
        part = self._download_part_path(local_path)
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        with open(part, "wb") as fh:
            fh.truncate(total)
        lock = threading.Lock()
        state = {"done": 0, "reported": 0, "last_ts": 0.0}

        def report(delta, force=False, emit=True):
            cb = None
            with lock:
                state["done"] = max(0, state["done"] + int(delta))
                now = time.time()
                if force:
                    state["done"] = total
                value = state["done"]
                should = emit and value > state["reported"] and (
                    value - state["reported"] >= 1024 * 1024 or
                    now - state["last_ts"] >= 0.5 or value >= total)
                if force and value >= total:
                    should = True
                if should:
                    state["reported"] = value
                    state["last_ts"] = now
                    cb = (value, total)
            if cb and progress:
                try:
                    progress(cb[0], cb[1])
                except Exception:
                    pass

        span = (total + workers - 1) // workers
        ranges = []
        for i in range(workers):
            start = i * span
            if start >= total:
                break
            end = min(total - 1, start + span - 1)
            ranges.append((start, end))

        def fetch(start, end):
            expected = end - start + 1
            last = None
            for attempt in range(3):
                received = 0
                reported = 0
                try:
                    headers = {"Range": "bytes=%d-%d" % (start, end)}
                    with self._open("GET", path, headers=headers,
                                    timeout=300, attempts=1) as resp:
                        try:
                            status = int(getattr(resp, "status", 200) or 200)
                        except Exception:
                            status = 200
                        if status != 206:
                            raise RuntimeError("range download unsupported")
                        content_range = (resp.headers.get("Content-Range") or "").strip()
                        m = re.match(r"bytes\s+(\d+)-(\d+)/(\d+|\*)\s*$",
                                     content_range)
                        if (not m or int(m.group(1)) != start
                                or int(m.group(2)) != end):
                            raise RuntimeError(
                                "range response mismatch: %r" % content_range)
                        with open(part, "r+b", buffering=0) as fh:
                            fh.seek(start)
                            while received < expected:
                                chunk = resp.read(min(1024 * 1024, expected - received))
                                if not chunk:
                                    break
                                fh.write(chunk)
                                received += len(chunk)
                                report(len(chunk))
                                reported += len(chunk)
                    if received != expected:
                        raise RuntimeError("range incomplete: got %d expected %d" %
                                           (received, expected))
                    return
                except Exception as exc:
                    last = exc
                    if reported:
                        report(-reported, emit=False)
                    if attempt < 2:
                        time.sleep(0.5 * (attempt + 1))
            raise last

        try:
            with ThreadPoolExecutor(max_workers=min(workers, len(ranges))) as pool:
                futures = [pool.submit(fetch, start, end) for start, end in ranges]
                for fut in as_completed(futures):
                    fut.result()
            if os.path.getsize(part) != total:
                raise RuntimeError("range merge size mismatch")
            report(0, force=True)
            return self._finish_download_part(part, local_path)
        except Exception:
            try:
                if os.path.exists(part):
                    os.remove(part)
            except OSError:
                pass
            raise

    def download(self, filename, subfolder="", out_type="output", local_path=None,
                 progress=None):
        """Download a /view output using parallel HTTP ranges when available.

        ComfyUI 0.31+ serves /view through aiohttp FileResponse, which supports
        byte ranges. Parallel ranges avoid the public gateway throttling one TCP
        stream and also reduce retry amplification. Unsupported gateways fall
        back to a single disk-streamed request.
        """
        q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder,
                                    "type": out_type})
        path = "/view?" + q
        if not local_path:
            data = None
            total = None
            for attempt in range(3):
                try:
                    buf = io.BytesIO()
                    with self._open("GET", path, timeout=600, attempts=1) as resp:
                        try:
                            total = int(resp.headers.get("Content-Length") or 0) or None
                        except Exception:
                            total = None
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            buf.write(chunk)
                    data = buf.getvalue()
                    break
                except Exception as exc:
                    _diag("download", cloud=self.cfg.get("name") or "?",
                          ctype=self.cfg.get("type") or "",
                          base_url=self.cfg.get("base_url") or "",
                          filename=filename, subfolder=subfolder,
                          exception="%s: %s" % (type(exc).__name__, exc))
                    if attempt == 2:
                        raise
                    time.sleep(1.0 + attempt)
            if data is None:
                raise RuntimeError("download failed: %s" % filename)
            if progress:
                try:
                    progress(len(data), total or len(data))
                except Exception:
                    pass
            return data
        total = None
        try:
            total = self._probe_range_total(path)
        except Exception:
            total = None
        if total and total >= 512 * 1024:
            try:
                return self._download_parallel_ranges(path, local_path, total, progress)
            except Exception as exc:
                _diag("download_range_fallback", cloud=self.cfg.get("name") or "?",
                      ctype=self.cfg.get("type") or "",
                      base_url=self.cfg.get("base_url") or "",
                      filename=filename, subfolder=subfolder,
                      exception="%s: %s" % (type(exc).__name__, exc))
        return self._download_stream(path, local_path, progress)

class AutoDLApiClient:
    """AutoDL API 镜像集群（autodl.art ComfyUI API，2026-08-23）。

    与自建 ComfyUI 不同，平台把工作流包装成 REST API：
      POST {base}/{workflow_id}        提交任务 -> data.task_id
      GET  {base}/result/{task_id}     轮询 -> data.status (QUEUED/RUNNING/SUCCESS/FAILED)
      SUCCESS 后 data.results[] 是短时效资源 URL，须尽快下载，超时失效。

    该集群没有 /upload、/history、/queue、/ws 等 ComfyUI 端点，
    history()/queue() 返回兼容形状，让上层轮询/回传逻辑复用。
    """

    DEFAULT_BASE = "https://autodl.art/api/v1/comfyui/comfyui_workflow"

    def __init__(self, cfg):
        self.cfg = cfg
        self.base = (cfg.get("api_base_url") or self.DEFAULT_BASE).rstrip("/")
        self.workflow_id = (cfg.get("workflow_id")
                            or "minimax_h3_lightx2v_v5").strip()
        self.token = (cfg.get("token") or "").strip()
        try:
            self.api_max_concurrency = max(1, int(cfg.get("api_max_concurrency") or 3))
        except Exception:
            self.api_max_concurrency = 3
        self._input_rules = None
        self._input_rules_ts = 0.0

    def _headers(self):
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = self.token
        return h

    def _request(self, method, path, data=None, timeout=120, retries=5):
        last = None
        for attempt in range(retries):  # 2026-09-06: retries param  # 2026-08-23：5 次重试，退避 2/4/6/8s
            try:
                req = urllib.request.Request(self.base + path,
                                             data=data, method=method)
                for k, v in self._headers().items():
                    req.add_header(k, v)
                return urllib.request.urlopen(req, timeout=timeout)
            except urllib.error.HTTPError as exc:
                detail = ""
                try:
                    detail = exc.read().decode("utf-8", "replace")[:400]
                except Exception:
                    pass
                if exc.code in (401, 403):
                    raise RuntimeError(
                        "AutoDL API Token 无效或无权限（HTTP %s）："
                        "请在算力集群设置里填写正确的 Token，"
                        "获取地址 https://autodl.art/large-model/tokens （分组选 ComfyUI）" % exc.code) \
                        from exc
                if exc.code == 404:
                    raise RuntimeError(
                        "AutoDL API 找不到任务或工作流（404）："
                        "请检查工作流 ID 是否正确") from exc
                if exc.code in (429, 500, 502, 503, 504):
                    if attempt < retries - 1:
                        last = exc
                        _delay = _retry_after_seconds(exc, attempt)
                        _LOGGER.warning(
                            "AutoDL API HTTP %s 第 %d/5 次重试（%.1fs）：%s",
                            exc.code, attempt + 1, _delay, detail[:120])
                        time.sleep(_delay)
                        continue
                    if exc.code == 429:
                        raise RuntimeError(
                            "AutoDL API 并发已达上限（当前账号同时最多约 %d 条生成任务，限流 429）："
                            "请等待已有任务完成，或减少同时提交的分段数量，"
                            "也可在算力集群设置里调整「平台并发上限」" % self.api_max_concurrency) from exc
                    if exc.code == 503:
                        raise RuntimeError(
                            "AutoDL API 平台服务异常（503）：平台过载/维护中，"
                            "也可能是当前账号并发任务已达上限（约 %d 条）；"
                            "软件已自动重试，请稍后再试" % self.api_max_concurrency) from exc
                    raise RuntimeError(
                        "AutoDL API 平台服务异常（HTTP %s）："
                        "平台过载或维护中，软件已自动重试，请稍后再试" % exc.code) from exc
                raise RuntimeError(
                    "AutoDL API 请求失败（HTTP %s）：%s"
                    % (exc.code, detail[:200])) from exc
            except Exception as exc:
                last = exc
                if attempt < retries - 1:
                    time.sleep(2 + 2 * attempt)
                    continue
                raise
        raise last if last is not None else RuntimeError("AutoDL API 请求失败")

    def _json(self, method, path, data=None, timeout=120, retries=5):
        with self._request(method, path, data=data, timeout=timeout, retries=retries) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))

    def test(self):
        """探测 Token 有效性与平台可达性（AutoDL API 无独立探测端点）。

        参考官方文档 https://autodl.art/docs/comfyui_api/ 做两步判断：
          ① 工作流详情接口 GET /api/v1/comfyui/workflows/{workflow_id} 公开可查，
             返回 code=Success 的 JSON 即说明「接口地址正确 + 该工作流存在 + 平台可达」；
          ② 查询接口 GET /comfyui_workflow/result/{task_id} 带无效 token 返回 401/403，
             带有效 token 则返回「任务不存在/其它」而非 401，因此可用它验证 token。

        2026-08-31 修复：不再用 __probe__（非官方端点）判定“未连通”，
        改为逐步校验接口地址/工作流/Token，避免 404 或 HTML 被误判。
        """
        if not self.token:
            return False, ("未填写 Token：请在算力集群设置里填写 autodl.art 令牌"
                           "（获取地址 https://autodl.art/large-model/tokens，分组选 ComfyUI）")
        # ① 平台可达 + 工作流存在（公开详情接口，无需鉴权）
        status, j, err = self._raw_json("GET", self._workflow_detail_url(),
                                        timeout=20, auth=False)
        code = str((j or {}).get("code") or "").strip().lower() if isinstance(j, dict) else ""
        if status == 200 and isinstance(j, dict) and code == "success":
            wf_name = ((j.get("data") or {})).get("name") or self.workflow_id
        else:
            self._record_test_err("workflow detail HTTP %s code=%s" % (status or "?", code or "None"))
            if status == 0:
                return False, ("平台不可达（%s）：请检查网络/接口地址" % (err or "连接失败"))
            if status == 200 and not isinstance(j, dict):
                return False, ("接口地址错误：返回的不是 API JSON（疑似填了主机或网页地址）。"
                               "请填完整接口地址，以 /api/v1/comfyui/comfyui_workflow 结尾")
            if status == 404:
                return False, ("平台可达，但「接口地址」或「工作流 ID」不对（404）："
                               "请确认接口地址以 /api/v1/comfyui/comfyui_workflow 结尾、"
                               "工作流 ID 正确（默认 minimax_h3_lightx2v_v5）")
            return False, ("工作流「%s」不存在或接口地址错误（HTTP %s，%s）："
                           "请确认工作流 ID 正确" % (self.workflow_id, status or "?",
                                                       (j or {}).get("msg") or err or "未知"))
        # ② 验证 Token：带 token 查一个不存在的任务，仅 401/403 才判定 token 无效
        status2, j2, err2 = self._raw_json("GET", "/result/__probe__",
                                           timeout=20, auth=True)
        if status2 in (401, 403):
            self._record_test_err("token 401/403")
            return False, ("Token 无效或无权限（HTTP %s）：请在算力集群设置里"
                           "填写正确的 Token（autodl.art，分组选 ComfyUI）" % status2)
        if status2 == 0:
            self._record_test_err("认证校验连接失败: %s" % (err2 or "网络异常"))
            return False, ("Token 校验连接失败（%s）" % (err2 or "网络连接失败"))
        # 2026-08-31：平台对无效 token 返回 401/403（Invalid authentication credentials），
        # 有效 token 即使查询的任务不存在，也会返回其它状态码/JSON（如 code=InternalError）。
        # 因此只要不是 401/403，即视为 token 被平台接受，不再因响应体形状误判“接口地址错误”。
        return True, ("连通成功：AutoDL API 平台可达，工作流「%s」存在，Token 有效"
                      "（工作流可用性以实际提交测试为准）" % wf_name)
    def _raw_json(self, method, url, data=None, timeout=20, auth=True):
        """低层请求：无论 HTTP 状态码都返回 (status, parsed_json_or_None, errmsg)。
        不抛异常，供 test() 精确区分 401/403（token 无效）与其它（认证通过/平台可达）。"""
        if not isinstance(url, str) or not url.startswith("http"):
            url = self.base + url
        last = None
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=data, method=method)
                h = {"Content-Type": "application/json"}
                if auth and self.token:
                    h["Authorization"] = self.token
                for k, v in h.items():
                    req.add_header(k, v)
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                    try:
                        return resp.status, json.loads(raw), ""
                    except Exception:
                        return resp.status, None, raw[:300]
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace")
                try:
                    return exc.code, json.loads(raw), ""
                except Exception:
                    return exc.code, None, raw[:300]
            except Exception as exc:
                last = exc
                if attempt < 1:
                    time.sleep(1)
        return 0, None, str(last)[:300]

    def _workflow_detail_url(self):
        """官方工作流详情接口 URL（公开，无需鉴权）。
        base 形如 https://host/api/v1/comfyui/comfyui_workflow，
        详情为 https://host/api/v1/comfyui/workflows/{id}。"""
        base = self.base.rstrip("/")
        suffix = "/comfyui_workflow"
        if base.endswith(suffix):
            base = base[:-len(suffix)]
        return base + "/workflows/" + self.workflow_id

    def fetch_input_rules(self, force=False, timeout=20, ttl=1800):
        """读取平台工作流详情接口返回的 input_rules（参数定义），带缓存。

        公开接口 GET /api/v1/comfyui/workflows/{workflow_id}（无需鉴权），
        input_rules 形如 {字段名: {node_id, field, required, type, min, max,
        default, accept_types, options}}。上层据此自动识别工作流模式并拼 body，
        字段名完全来自平台、不臆造。fetch 失败返回 {}，让上层安全回退旧模板逻辑。
        """
        now = time.time()
        if (not force and self._input_rules is not None
                and now - self._input_rules_ts < ttl):
            return self._input_rules
        status, j, err = self._raw_json("GET", self._workflow_detail_url(),
                                        timeout=timeout, auth=False)
        code = str((j or {}).get("code") or "").strip().lower() \
            if isinstance(j, dict) else ""
        if status == 200 and isinstance(j, dict) and code == "success":
            d = j.get("data") or {}
            rules = d.get("input_rules")
            if isinstance(rules, dict) and rules:
                self._input_rules = rules
                self._input_rules_ts = now
                return dict(rules)
        self._input_rules = None
        self._input_rules_ts = 0.0
        return {}

    def _record_test_err(self, detail):
        try:
            from server.services import diag
            diag.record_cloud_error("test", cloud=self.cfg.get("name") or "?",
                                    ctype=self.cfg.get("type") or "",
                                    base_url=self.cfg.get("base_url") or "",
                                    exception=detail)
        except Exception:
            pass
    def ping(self):
        try:
            ok, _ = self.test()
            return ok
        except Exception:
            return False

    def submit(self, body):
        """提交任务。body 是工作流抽屉里的请求参数（prompt/duration/...）。
        返回 {"prompt_id": task_id} 兼容上层。"""
        if not self.token:
            raise RuntimeError(
                "AutoDL API 集群未填写 Token，请在算力集群设置里填写"
                "（获取地址 https://autodl.art/large-model/tokens）")
        try:
            j = self._json("POST", "/" + self.workflow_id,
                           data=json.dumps(body).encode("utf-8"), timeout=120, retries=1)
        except Exception as exc:
            _diag("submit", cloud=self.cfg.get("name") or "?",
                  ctype=self.cfg.get("type") or "",
                  base_url=self.cfg.get("base_url") or "",
                  exception="%s: %s" % (type(exc).__name__, exc))
            raise
        data = j.get("data") or {}
        task_id = data.get("task_id") or ""
        if not task_id:
            raise RuntimeError("AutoDL API 提交失败：%s"
                               % ((j.get("msg") or j.get("message")
                                   or "未返回任务ID")[:200]))
        return {"prompt_id": task_id, "task_id": task_id}

    def poll(self, task_id):
        """查询任务，返回 data 字典（status/results/message...）。"""
        if not task_id:
            raise RuntimeError("AutoDL API 缺少任务 ID")
        try:
            j = self._json("GET", "/result/" + str(task_id), timeout=45, retries=1)
        except Exception as exc:
            _diag("poll", cloud=self.cfg.get("name") or "?",
                  ctype=self.cfg.get("type") or "",
                  base_url=self.cfg.get("base_url") or "",
                  task_id=task_id,
                  exception="%s: %s" % (type(exc).__name__, exc))
            raise
        return j.get("data") or {}

    def history(self, prompt_id):
        """兼容层：把 API 轮询结果转成 ComfyUI history 形状，
        _pick_video_output 能直接挑出成片 URL，上层恢复回传逻辑全部复用。"""
        try:
            data = self.poll(prompt_id)
        except Exception as exc:
            return {"error": str(exc)[:200]}
        status = (data.get("status") or "").upper()
        if status == "SUCCESS":
            url = self._first_result_url(data)
            if url:
                return {"status": {"status_str": "success"},
                        "outputs": {"api_out": {"video": [{"filename": url}]}}}
            return {"status": {"status_str": "success"}, "outputs": {}}
        if status == "FAILED":
            return {"status": {"status_str": "error"},
                    "error": (data.get("message") or data.get("msg")
                              or "任务执行失败")[:300]}
        if status in ("QUEUED", "RUNNING"):
            return {"status": {"status_str": "running"}}
        return {"error": "未知状态：%s" % (status or "?")}

    @staticmethod
    def _first_result_url(data):
        results = data.get("results") or []
        for r in results:
            if isinstance(r, str) and r.startswith("http"):
                return r
            if isinstance(r, dict):
                # 兼容 {url:...} / {data:[url]} / {file_url:...} 等可能结构
                for k in ("url", "file_url", "file", "video_url"):
                    v = r.get(k)
                    if isinstance(v, str) and v.startswith("http"):
                        return v
                d = r.get("data")
                if isinstance(d, list):
                    for v in d:
                        if isinstance(v, str) and v.startswith("http"):
                            return v
        return ""

    def queue(self):
        # API 镜像无队列端点：返回空，上层按 history 状态判断
        return {}

    def object_info(self, timeout=60):
        # API 镜像无 object_info：返回空（二采探测自动回退 latent/关闭）
        return {}

    def interrupt(self):
        return False

    def queue_delete(self, prompt_ids):
        return False

    def upload(self, local_path, kind="image"):
        raise RuntimeError(
            "AutoDL API 镜像由平台托管工作流与素材，不支持直接上传素材；"
            "请在请求体模板里按平台工作流要求传入素材地址")

    def _url_range_total(self, url):
        """Return total size when a temporary result URL supports byte ranges."""
        try:
            req = urllib.request.Request(url, method="GET", headers={"Range": "bytes=0-0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                if int(getattr(resp, "status", 200) or 200) != 206:
                    return None
                cr = (resp.headers.get("Content-Range") or "").strip()
                m = re.search(r"/(\d+)\s*$", cr)
                if not m:
                    return None
                total = int(m.group(1))
                return total if total > 0 else None
        except Exception:
            return None

    def _stream_url_to_path(self, url, local_path, progress=None):
        """Stream a short-lived result URL to disk without buffering it in RAM."""
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        part = "%s.part.%d.%d" % (local_path, os.getpid(), int(time.time() * 1000))
        last = None
        for attempt in range(5):
            done = 0
            total = None
            try:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=600) as resp:
                    try:
                        total = int(resp.headers.get("Content-Length") or 0) or None
                    except Exception:
                        total = None
                    with open(part, "wb") as fh:
                        last_report = 0
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            fh.write(chunk)
                            done += len(chunk)
                            if progress and (done - last_report >= 1024 * 1024 or
                                             (total and done >= total)):
                                last_report = done
                                try:
                                    progress(done, total or done)
                                except Exception:
                                    pass
                        fh.flush()
                        os.fsync(fh.fileno())
                if total and done != total:
                    raise RuntimeError("download incomplete: got %d expected %d" % (done, total))
                for _ in range(5):
                    try:
                        os.replace(part, local_path)
                        if progress:
                            try:
                                progress(done, total or done)
                            except Exception:
                                pass
                        return local_path
                    except OSError:
                        time.sleep(0.3)
                raise RuntimeError("cannot publish downloaded video: %s" % local_path)
            except Exception as exc:
                last = exc
                try:
                    if os.path.exists(part):
                        os.remove(part)
                except OSError:
                    pass
                if attempt < 4:
                    time.sleep(1.0 + attempt)
        raise last if last is not None else RuntimeError("download failed")

    def _ranged_url_to_path(self, url, local_path, total, progress=None):
        """Download disjoint byte ranges concurrently and merge into one file."""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        try:
            workers = int(os.environ.get("H3_DOWNLOAD_WORKERS") or "4")
        except Exception:
            workers = 4
        workers = max(1, min(8, workers))
        if workers <= 1 or total < 512 * 1024:
            return self._stream_url_to_path(url, local_path, progress)
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
        part = "%s.part.%d.%d" % (local_path, os.getpid(), int(time.time() * 1000))
        with open(part, "wb") as fh:
            fh.truncate(total)
        done = 0
        lock = threading.Lock()

        def report(delta):
            nonlocal done
            if not progress:
                return
            with lock:
                done += delta
                cur = done
            try:
                progress(cur, total)
            except Exception:
                pass

        span = (total + workers - 1) // workers
        ranges = []
        for idx in range(workers):
            start = idx * span
            if start >= total:
                break
            ranges.append((start, min(total - 1, start + span - 1)))

        def fetch(start, end):
            expected = end - start + 1
            last = None
            for attempt in range(3):
                received = 0
                try:
                    req = urllib.request.Request(
                        url, method="GET",
                        headers={"Range": "bytes=%d-%d" % (start, end)})
                    with urllib.request.urlopen(req, timeout=300) as resp:
                        if int(getattr(resp, "status", 200) or 200) != 206:
                            raise RuntimeError("range download unsupported")
                        cr = (resp.headers.get("Content-Range") or "").strip()
                        m = re.match(r"bytes\s+(\d+)-(\d+)/(\d+|\*)\s*$", cr)
                        if not m or int(m.group(1)) != start or int(m.group(2)) != end:
                            raise RuntimeError("range response mismatch: %r" % cr)
                        with open(part, "r+b", buffering=0) as fh:
                            fh.seek(start)
                            while received < expected:
                                chunk = resp.read(min(1024 * 1024, expected - received))
                                if not chunk:
                                    break
                                fh.write(chunk)
                                received += len(chunk)
                                report(len(chunk))
                    if received != expected:
                        raise RuntimeError("range incomplete: got %d expected %d" %
                                           (received, expected))
                    return
                except Exception as exc:
                    last = exc
                    if received:
                        report(-received)
                    if attempt < 2:
                        time.sleep(0.5 * (attempt + 1))
            raise last

        try:
            with ThreadPoolExecutor(max_workers=min(workers, len(ranges))) as pool:
                futures = [pool.submit(fetch, a, b) for a, b in ranges]
                for fut in as_completed(futures):
                    fut.result()
            if os.path.getsize(part) != total:
                raise RuntimeError("range merge size mismatch")
            for _ in range(5):
                try:
                    os.replace(part, local_path)
                    if progress:
                        try:
                            progress(total, total)
                        except Exception:
                            pass
                    return local_path
                except OSError:
                    time.sleep(0.3)
            raise RuntimeError("cannot publish downloaded video: %s" % local_path)
        except Exception:
            try:
                if os.path.exists(part):
                    os.remove(part)
            except OSError:
                pass
            raise

    def download(self, filename, subfolder="", out_type="output", local_path=None,
                 progress=None):
        """Download a short-lived result URL; disk-backed with parallel ranges."""
        url = filename if filename.startswith("http") else self.base + filename
        if local_path:
            total = self._url_range_total(url)
            if total and total >= 512 * 1024:
                try:
                    return self._ranged_url_to_path(url, local_path, total, progress)
                except Exception:
                    pass
            return self._stream_url_to_path(url, local_path, progress)
        data = None
        total = None
        for _ in range(5):
            try:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=600) as resp:
                    try:
                        total = int(resp.headers.get("Content-Length") or 0) or None
                    except Exception:
                        total = None
                    buf = io.BytesIO()
                    done = 0
                    while True:
                        chunk = resp.read(262144)
                        if not chunk:
                            break
                        buf.write(chunk)
                        done += len(chunk)
                        if progress:
                            try:
                                progress(done, total or done)
                            except Exception:
                                pass
                    data = buf.getvalue()
                break
            except Exception as exc:
                _diag("download", cloud=self.cfg.get("name") or "?",
                      ctype=self.cfg.get("type") or "",
                      base_url=self.cfg.get("base_url") or "",
                      filename=filename,
                      exception="%s: %s" % (type(exc).__name__, exc))
                if _ == 4:
                    raise RuntimeError("AutoDL API download failed: %s" % str(exc)[:200])
                time.sleep(3)
        if data is None:
            raise RuntimeError("AutoDL API download failed: no data")
        if data[:4] == b"\x00\x00\x00" and data[4:8] == b"ftyp":
            pass
        elif len(data) < 4096 and b"error" in data[:2048].lower():
            raise RuntimeError("AutoDL API download failed: %s"
                               % data[:200].decode("utf-8", "replace"))
        return data
