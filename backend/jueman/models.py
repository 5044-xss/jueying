# -*- coding: utf-8 -*-
"""明文模型文件解析（替代原 keyguard 的"毒化/碎片"机制）。

方案2：
  - 不再向授权服务器取碎片，直接使用明文默认值；
  - 可由 config.json 的 "models" 字段覆盖；
  - 也可在连接云端后用 /object_info 自动探测真实文件名并写回配置。

workflows.py 只调用 resolve_string(name)，name 取值见 _REAL 的键。
"""

# 明文真实默认值（原 keyguard._REAL）。
_REAL = {
    "unet": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "lora": "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vvae": "minimax_h3_video_vae_fp16.safetensors",
    "avae": "minimax_h3_audio_vae_fp32.safetensors",
    "learned": "minimax_h3_latent_upscaler_3d_bf16.safetensors",
    "wf": "minimax_h3_lightx2v_v5",
}

# 由 /object_info 自动探测的覆盖值（进程内缓存，不落盘）。
_AUTO = {}


def set_auto(values):
    """写入自动探测到的文件名覆盖值（只认已知键）。"""
    for k, v in (values or {}).items():
        if k in _REAL and v:
            _AUTO[k] = str(v)


def get_auto():
    return dict(_AUTO)


def resolve_string(name):
    """返回该字段的真实文件名。未知字段返回 None。"""
    if name not in _REAL:
        return None
    try:
        from . import config
        over = (config.get().get("models") or {})
    except Exception:
        over = {}
    v = over.get(name) or _AUTO.get(name)
    if v:
        return str(v)
    return _REAL[name]
