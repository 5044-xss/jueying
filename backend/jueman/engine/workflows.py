"""ComfyUI workflow builder for H3 FL2VA + official 8-step LoRA (shared).

2026-10-13 迁移新镜像（ComfyUI 0.39.1 + XB_ToolBox，无 MultiRate 节点）：
  - 采样链路按 /object_info 探测能力选择：有 MiniMaxH3MultiRateSamplerEXPT8 才用，
    否则退回官方核心 KSamplerSelect + BasicScheduler + BasicGuider + SamplerCustomAdvanced。
  - Sage：优先 XB_Sage_BlockSwap（A3 策略：长片关闭、短片开启，24G 一律 block swap）。
  - 输出：有 SaveVideo 用 CreateVideo + SaveVideo，否则退回 VHS_VideoCombine。
  - XB_HailuoH3VideoParams 新节点无 fps/fps_float，改用 scale_factor；MP 夹取 ≤0.98。
  - 帧数吸附 17k+5 栅格（124/243/362）。
"""
import random

from jueman import models as _kg

WORKFLOW_VERSION = "20261013-01"

# 新镜像模型在根目录（无 MiniMax-H3 前缀）；旧镜像可显式传 "MiniMax-H3"。
DEFAULT_MODEL_PREFIX = ""
H3_FL2VA_UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
H3_REF2VA_UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"

# H3 原生帧数栅格：17k+5（124 / 243 / 362 ...）
_FRAME_GRID = 17
_FRAME_OFFSET = 5
_FRAME_MIN = 124

# 原生分辨率上限（≈768p），超过是“虚胖”：不变清、只更慢更吃显存。
MAX_MEGAPIXELS = 0.98


def snap_length(frames):
    """把帧数吸附到 H3 官方 17k+5 栅格（124/243/362...）。"""
    try:
        k = int(round((float(frames) - _FRAME_OFFSET) / float(_FRAME_GRID)))
    except (TypeError, ValueError):
        return _FRAME_MIN
    return max(_FRAME_MIN, _FRAME_GRID * k + _FRAME_OFFSET)


def _sage_choice(gen):
    """Sage 总开关：开=一直用 Sage，关=完全不用。blocks_to_swap 默认 50（24G）。

    注意：新版本栈下长片开 Sage 存在 aimdo 崩溃风险，交由用户自行取舍。
    """
    try:
        blocks = int(gen.get("blocks_to_swap", 50) or 0)
    except (TypeError, ValueError):
        blocks = 50
    enabled = bool(gen.get("sage_enabled", True))
    preset = str(gen.get("sage_preset") or "Nvidia-Sage") if enabled else "关闭"
    return preset, blocks


def make_workflow(prompt_text, name, assets, gen=None, duration=None,
                  refs_text=None, audio_text=None, model_prefix=DEFAULT_MODEL_PREFIX,
                  lora_prefix=None, clip_name=None, sampler_mode="legacy",
                  resolution_node=None, size=None, resolution=None,
                  model_variant=None, caps=None):
    """Build the ComfyUI node dict (no {"prompt": ...} wrapper).

    Callers submit via POST /prompt with body {"prompt": <this dict>}.

    assets: 动态资产列表（按分镜实际用到生成，H3 上限 8 图 / 3 音频 / 3 视频）：
      {"images": [remote_name...], "audios": [remote_name...], "videos": [remote_name...]}
    兼容旧 6 槽 dict {gu_pic, zhao_pic, room_pic, gu_detail, zhao_audio, gu_audio}。
    gen: generation params from config (width/height/duration/seed/lora...).
    duration: 该段成片时长（秒，4-15）；不传则用 gen.duration_max（默认 10）。
    model_prefix: 云端模型目录前缀（新镜像根目录传 ""；旧仙宫云传 "MiniMax-H3"）。
    lora_prefix: LoRA 目录前缀，默认与 model_prefix 相同；根目录传 ""。
    clip_name: 显式指定 CLIP 文件名；None 时用 models.clip。
    model_variant: "auto" 时仅当音频/视频参考存在才自动切 Ref2VA，纯图保持 FL2VA。
    caps: 由 /object_info 探测到的集群能力（jobs._cluster_caps）：
      has_multirate / has_sage_blockswap / has_sage_patch / has_savevideo /
      has_vhs / has_xb_resolution / has_upscaler3d / has_latent_upscale。
      None 时按旧 sampler_mode/resolution_node 推断（向后兼容旧镜像）。
    """
    g = gen or {}
    if lora_prefix is None:
        lora_prefix = model_prefix
    dur = duration or g.get("duration_max", 10)
    dur = min(max(int(dur), 4), 15)
    _seed_val = int(g.get("seed", 0) or 0)
    # 0 或 seed_auto=True 均视为随机种子。
    if g.get("seed_auto", True) or not _seed_val:
        seed = random.randint(1, 10 ** 9)
    else:
        seed = _seed_val
    # 兼容旧 6 槽 dict
    if "images" not in assets and "audios" not in assets:
        assets = {
            "images": [assets.get("gu_pic", ""), assets.get("zhao_pic", ""),
                       assets.get("room_pic", ""), assets.get("gu_detail", "")],
            "audios": [assets.get("zhao_audio", ""), assets.get("gu_audio", "")],
            "videos": [],
        }
    images = [x for x in (assets.get("images") or []) if x][:8]
    audios = [x for x in (assets.get("audios") or []) if x][:3]
    videos = [x for x in (assets.get("videos") or []) if x][:3]

    # --- 集群能力：caps 优先；缺省时按旧参数推断（兼容旧镜像） ---
    if caps is None:
        _xb = ((resolution_node or "").strip().lower() == "xb")
        caps = {
            "has_multirate": True,
            "has_sage_blockswap": _xb,
            "has_sage_patch": not _xb,
            "has_savevideo": (str(sampler_mode).lower() == "new"),
            "has_vhs": True,
            "has_xb_resolution": _xb,
            "has_upscaler3d": True,
            "has_latent_upscale": True,
        }
    use_multirate = bool(caps.get("has_multirate"))
    use_xb_sage = bool(caps.get("has_sage_blockswap"))
    use_sage_patch = bool(caps.get("has_sage_patch"))
    use_savevideo = bool(caps.get("has_savevideo"))
    has_upscaler3d = bool(caps.get("has_upscaler3d"))
    has_latent_upscale = bool(caps.get("has_latent_upscale", True))

    # Automatic model routing is intentionally limited to real AV references.
    # Pure image / no-reference jobs keep the existing FL2VA path unchanged.
    _variant = (model_variant or "").strip().lower()
    _auto_route = (_variant == "auto")
    if _auto_route:
        _variant = "ref2va" if (audios or videos) else "fl2va"
    _unet_explicit = (g.get("unet_name") or "").strip()
    if _variant in ("ref2va", "ref"):
        _ref_explicit = (g.get("ref2va_unet_name") or "").strip()
        _unet_file = _ref_explicit or ("" if _auto_route else _unet_explicit) or H3_REF2VA_UNET
    else:
        _unet_file = _unet_explicit or _kg.resolve_string("unet") or H3_FL2VA_UNET

    # 加速方式（官方 Turbo LoRA，8 步、强度 1.0）
    _kg_lora = _kg.resolve_string("lora") or "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors"
    _lora_file = (g.get("lora_name") or "").strip() or _kg_lora
    lora_name = (lora_prefix + "/" if lora_prefix else "") + _lora_file
    if clip_name is None:
        clip_name = _kg.resolve_string("clip") or "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    default_video_steps = 8
    default_audio_steps = 8

    def _join(prefix, fname):
        return (prefix + "/" if prefix else "") + fname

    wf = {
        "182": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "232": {"class_type": "UNETLoader", "inputs": {"unet_name": _join(model_prefix, _unet_file), "weight_dtype": "default"}},
        "231": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["232", 0], "lora_name": lora_name, "strength_model": g.get("lora_strength", 1.0)}},
        "233": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip_name, "type": "minimax", "device": "default"}},
        "234": {"class_type": "VAELoader", "inputs": {"vae_name": _join(model_prefix, _kg.resolve_string("vvae") or "minimax_h3_video_vae_fp16.safetensors")}},
        "235": {"class_type": "VAELoader", "inputs": {"vae_name": _join(model_prefix, _kg.resolve_string("avae") or "minimax_h3_audio_vae_fp32.safetensors")}},
        "209": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": prompt_text}},
    }
    # 质感 LoRA（可选，模型层祛 AI 味）：在 turbo LoRA 之后再挂一个写实/质感 LoRA。
    model_ref = ["231", 0]
    quality_lora = (g.get("quality_lora") or "").strip()
    quality_lora_strength = float(g.get("quality_lora_strength", 0.8) or 0.8)
    if quality_lora:
        ql_name = _join(lora_prefix, quality_lora)
        wf["252"] = {"class_type": "LoraLoaderModelOnly",
                     "inputs": {"model": model_ref, "lora_name": ql_name,
                                "strength_model": quality_lora_strength}}
        model_ref = ["252", 0]

    # --- Sage / block swap（A3）：长片关 Sage、短片开；24G 一律 block swap ---
    if use_xb_sage:
        _preset, _blocks = _sage_choice(g)
        wf["230"] = {"class_type": "XB_Sage_BlockSwap",
                     "inputs": {"model": model_ref, "sage_preset": _preset,
                                "blocks_to_swap": _blocks}}
        model_ref = ["230", 0]
    elif use_sage_patch:
        wf["230"] = {"class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
                     "inputs": {"model": model_ref}}
        model_ref = ["230", 0]

    # --- 二采参数（可选，latent 放大 + 低 denoise refine） ---
    steps = g.get("video_steps", default_video_steps)
    second_pass = bool(g.get("second_pass", False))
    second_scale = max(1.0, float(g.get("second_scale", 1.5) or 1.5))
    second_steps = int(g.get("second_steps", steps) or steps)
    second_denoise = min(1.0, max(0.1, float(g.get("second_denoise", 0.3) or 0.3)))
    second_upscaler = str(g.get("second_upscaler", "learned") or "learned").lower()
    _umodels = [str(x) for x in (caps.get("upscaler_models") or [])]
    # learned 节点缺失、或节点在但没有任何可用放大模型 → 退回核心 LatentUpscaleBy。
    if second_upscaler == "learned" and (
            not has_upscaler3d
            or ("upscaler_models" in caps and not _umodels)):
        second_upscaler = "latent"
    if second_upscaler == "h3" and not has_latent_upscale:
        second_upscaler = "latent"
    learned_model = str(g.get("learned_model",
                              (_kg.resolve_string("learned") or "minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors")) or
                        (_kg.resolve_string("learned") or "minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors"))
    # 主动对齐：若集群上报了可用放大模型且当前名不在其中，自动选一个兼容项。
    if second_upscaler == "learned" and _umodels:
        def _base(p):
            return str(p).split("/")[-1].lower()
        if _base(learned_model) not in {_base(m) for m in _umodels}:
            cands = [m for m in _umodels if "latent_upscaler" in m.lower()] or list(_umodels)
            cands.sort(key=lambda m: (0 if "conv_v1" in m.lower() else 1))
            learned_model = cands[0]

    # --- 一采：MultiRate（若集群有）或官方核心 KSamplerSelect + BasicScheduler ---
    if use_multirate:
        # EXP 多速率采样器要求 audio_steps >= video_steps（每个视频宏步至少一次联合 H3 调用）。
        _vs = int(g.get("video_steps", default_video_steps) or default_video_steps)
        _as = int(g.get("audio_steps", default_audio_steps) or default_audio_steps)
        _as = max(_as, _vs)
        wf["241"] = {"class_type": "MiniMaxH3MultiRateSamplerEXPT8",
                     "inputs": {"model": model_ref, "av_latent": ["167", 1],
                                "video_steps": _vs,
                                "audio_steps": _as,
                                "shift_video": g.get("shift_video", 12),
                                "shift_audio": g.get("shift_audio", 3)}}
        wf["183"] = {"class_type": "BasicGuider",
                     "inputs": {"model": ["241", 0], "conditioning": ["167", 0]}}
        wf["188"] = {"class_type": "SamplerCustomAdvanced",
                     "inputs": {"noise": ["182", 0], "guider": ["183", 0],
                                "sampler": ["241", 1], "sigmas": ["241", 2],
                                "latent_image": ["167", 1]}}
    else:
        wf["236"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
        wf["238"] = {"class_type": "BasicScheduler",
                     "inputs": {"model": model_ref,
                                "steps": int(g.get("video_steps", default_video_steps) or default_video_steps),
                                "scheduler": "simple", "denoise": 1.0}}
        wf["183"] = {"class_type": "BasicGuider",
                     "inputs": {"model": model_ref, "conditioning": ["167", 0]}}
        wf["188"] = {"class_type": "SamplerCustomAdvanced",
                     "inputs": {"noise": ["182", 0], "guider": ["183", 0],
                                "sampler": ["236", 0], "sigmas": ["238", 0],
                                "latent_image": ["167", 1]}}
    sample_out = "188"

    if second_pass:
        wf["242"] = {"class_type": "LTXVSeparateAVLatent",
                     "inputs": {"av_latent": [sample_out, 0]}}
        if second_upscaler == "learned":
            wf["243"] = {"class_type": "MinimaxH3LatentUpscaler3D",
                         "inputs": {"latent": ["242", 0],
                                    "model_name": learned_model,
                                    "mode": "scale by multiplier",
                                    "mode.scale": second_scale,
                                    "align": 32,
                                    "enable_temporal_chunking": True,
                                    "force_unload": True,
                                    "device": "cuda",
                                    "precision": "bf16"}}
        elif second_upscaler == "h3":
            wf["243"] = {"class_type": "H3LatentUpscaleByJingchen573",
                         "inputs": {"samples": ["242", 0], "upscale_method": "bicubic",
                                    "scale_by": second_scale}}
        else:
            wf["243"] = {"class_type": "LatentUpscaleBy",
                         "inputs": {"samples": ["242", 0], "upscale_method": "bicubic",
                                    "scale_by": second_scale}}
        wf["244"] = {"class_type": "LTXVConcatAVLatent",
                     "inputs": {"video_latent": ["243", 0], "audio_latent": ["242", 1]}}
        # 二采复用一采噪声种子（同一 RandomNoise 值，保动作细节）
        wf["245"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
        wf["246"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
        wf["247"] = {"class_type": "BasicScheduler",
                     "inputs": {"model": model_ref, "steps": second_steps,
                                "scheduler": "simple", "denoise": second_denoise}}
        wf["248"] = {"class_type": "BasicGuider",
                     "inputs": {"model": model_ref, "conditioning": ["167", 0]}}
        wf["249"] = {"class_type": "SamplerCustomAdvanced",
                     "inputs": {"noise": ["245", 0], "guider": ["248", 0],
                                "sampler": ["246", 0], "sigmas": ["247", 0],
                                "latent_image": ["244", 0]}}
        # 音频锁定：二采只精修视频，音频换回一采原始 latent，避免段首怪叫。
        wf["250"] = {"class_type": "LTXVSeparateAVLatent",
                     "inputs": {"av_latent": ["249", 0]}}
        wf["251"] = {"class_type": "LTXVConcatAVLatent",
                     "inputs": {"video_latent": ["250", 0],
                                "audio_latent": ["242", 1]}}
        sample_out = "251"

    # --- 解码（核心节点，跨版本稳定） ---
    wf["189"] = {"class_type": "VAEDecode", "inputs": {"samples": [sample_out, 0], "vae": ["234", 0]}}
    wf["190"] = {"class_type": "VAEDecodeAudio", "inputs": {"samples": [sample_out, 0], "vae": ["235", 0]}}

    # --- 输出：优先新版 SaveVideo，退回 VHS_VideoCombine ---
    if use_savevideo:
        wf["240"] = {"class_type": "CreateVideo",
                     "inputs": {"images": ["189", 0], "audio": ["190", 0], "fps": 24}}
        wf["92"] = {"class_type": "SaveVideo",
                    "inputs": {"video": ["240", 0],
                               "filename_prefix": "视频/H3Studio-" + name,
                               "format": "auto"}}
    else:
        wf["237"] = {"class_type": "VHS_VideoCombine",
                     "inputs": {"images": ["189", 0], "audio": ["190", 0],
                                "frame_rate": 24, "loop_count": 0,
                                "filename_prefix": "视频/H3Studio-" + name,
                                "format": "video/h264-mp4", "pingpong": False,
                                "save_output": True}}

    # 动态 LoadImage / LoadAudio / LoadVideo
    for i, img in enumerate(images):
        wf[str(1000 + i)] = {"class_type": "LoadImage", "inputs": {"image": img}}
    for i, aud in enumerate(audios):
        wf[str(2000 + i)] = {"class_type": "LoadAudio", "inputs": {"audio": aud}}
    for i, vid in enumerate(videos):
        # Motion Context：ref_videos 期望 IMAGE 帧序列（24fps, 2-15s）。
        wf[str(3000 + i)] = {"class_type": "VHS_LoadVideo",
                             "inputs": {"video": vid, "force_rate": 24,
                                        "custom_width": 0, "custom_height": 0,
                                        "frame_load_cap": 0, "skip_first_frames": 0,
                                        "select_every_nth": 1}}

    # 动态 MiniMaxH3ReferenceToVideo 参考槽
    ref_node = {
        "clip": ["233", 0], "vae": ["234", 0], "audio_vae": ["235", 0],
        "prompt": ["209", 0],
        "width": g.get("width", 960), "height": g.get("height", 544),
        "length": snap_length(dur * 24 + 3), "ref_image_size": "match",
    }
    for i in range(len(images)):
        ref_node["ref_images.ref_image_%d" % i] = [str(1000 + i), 0]
    for i in range(len(audios)):
        ref_node["ref_audios.ref_audio_%d" % i] = [str(2000 + i), 0]
    for i in range(len(videos)):
        ref_node["ref_videos.ref_video_%d" % i] = [str(3000 + i), 0]

    # --- 分辨率节点（XB_HailuoH3VideoParams）：输出 Width/Height/Frames ---
    _rn = (resolution_node or "").strip().lower()
    _sz = (size or "").strip()
    _res = (resolution or "").strip()
    _RATIO_COMBO = {
        "1:1": "1:1 (Square)", "2:3": "2:3 (Portrait Photo)", "3:2": "3:2 (Photo)",
        "3:4": "3:4 (Portrait Standard)", "4:3": "4:3 (Standard)",
        "9:16": "9:16 (Portrait Widescreen)", "16:9": "16:9 (Widescreen)",
        "21:9": "21:9 (Ultrawide)", "4:5": "4:5 (Portrait Tall)", "5:4": "5:4 (Landscape Tall)",
    }
    _combo = _RATIO_COMBO.get(_sz.lower(), "16:9 (Widescreen)")
    try:
        _mp = float(_res) if _res else float(g.get("megapixels") or 1.0)
    except (TypeError, ValueError):
        _mp = float(g.get("megapixels") or 1.0)
    # A2：原生上限 768p（≈0.98MP），夹取防“虚胖”。
    _mp = min(max(_mp, 0.1), MAX_MEGAPIXELS)
    if _rn == "xb":
        # 新节点无 fps/fps_float；scale_factor 为必填（旧值 1.0）。
        wf["555"] = {"class_type": "XB_HailuoH3VideoParams", "inputs": {
            "aspect_ratio": _combo, "megapixels": _mp, "multiple": 32,
            "duration": dur, "scale_factor": 1.0}}
        ref_node["width"] = ["555", 0]
        ref_node["height"] = ["555", 1]
        ref_node["length"] = ["555", 2]
    wf["167"] = {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": ref_node}
    return wf
