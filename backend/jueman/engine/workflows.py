"""ComfyUI workflow builder for H3 FL2VA + official 8-step LoRA (shared)."""
import random

from jueman import models as _kg

WORKFLOW_VERSION = "20260906-01"

# 云端模型目录前缀的唯一定义处：仙宫云 MiniMax-H3；AutoDL 模型在根目录时传 ""。
DEFAULT_MODEL_PREFIX = "MiniMax-H3"
H3_FL2VA_UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
H3_REF2VA_UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"


def make_workflow(prompt_text, name, assets, gen=None, duration=None,
                  refs_text=None, audio_text=None, model_prefix=DEFAULT_MODEL_PREFIX,
                  lora_prefix=None, clip_name=None, sampler_mode="legacy",
                  resolution_node=None, size=None, resolution=None,
                  model_variant=None):
    """Build the ComfyUI node dict (no {"prompt": ...} wrapper).

    Callers submit via POST /prompt with body {"prompt": <this dict>}.

    assets: 动态资产列表（按分镜实际用到生成，H3 上限 8 图 / 3 音频 / 3 视频）：
      {"images": [remote_name...], "audios": [remote_name...], "videos": [remote_name...]}
    兼容旧 6 槽 dict {gu_pic, zhao_pic, room_pic, gu_detail, zhao_audio, gu_audio}。
    gen: generation params from config (width/height/duration/seed/lora...).
    duration: 该段成片时长（秒，4-15）；不传则用 gen.duration_max（默认 10）。
    refs_text/audio_text: 节点 227 的参考图片/音频介绍（由调用方按实体动态生成）。
    model_prefix: 云端模型目录前缀（仙宫云 MiniMax-H3 / AutoDL 模型在根目录时传 ""）。
    lora_prefix: LoRA 目录前缀，默认与 model_prefix 相同；AutoDL 的 LoRA 在根目录时传 ""。
    clip_name: 显式指定 CLIP 文件名；None 时用默认 nvfp4_awq（兼容仙宫云），
       AutoDL 用 int4_convrot 时由调用方传入。
    model_variant: "auto" 时仅当音频/视频参考存在才自动切 Ref2VA，纯图保持 FL2VA；
        None 保持旧行为，显式 "ref2va" 可强制 Ref2VA。
    sampler_mode: "legacy"=旧版多速率采样链路（MultiRateSamplerEXPT8+SageAttention，
       兼容未升级的仙宫云 ComfyUI）；"new"=官方新版链路
       （KSamplerSelect res_multistep + BasicScheduler simple + BasicGuider +
       SamplerCustomAdvanced + CreateVideo + SaveVideo，AutoDL 已升级新版 ComfyUI）。
    """
    g = gen or {}
    if lora_prefix is None:
        lora_prefix = model_prefix
    dur = duration or g.get("duration_max", 10)
    dur = min(max(int(dur), 4), 15)
    seed = random.randint(1, 10 ** 9) if g.get("seed_auto", True) else int(g.get("seed", 20260812))
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
    refs = refs_text or "图1角色1正面半身，图2角色2形象，图3场景，图4细节参考"
    arefs = audio_text or "音频1角色1音色参考，音频2角色2音色参考"
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

    # 加速方式（2026-08-16 实测固化：仅用官方 FL2VA 8 步 v1.0 LoRA，
    # 强度 1.0、音视频各 8 步、ref_image_size=match；旧 lightx2v 4 步弃用）
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
    # 2026-08-30 质感 LoRA（可选，模型层祛 AI 味）：在 turbo 8 步 LoRA 之后
    # 再挂一个写实/质感 LoRA（如 fal r34l1sm），由 gen["quality_lora"] 指定。
    model_ref = ["231", 0]
    quality_lora = (g.get("quality_lora") or "").strip()
    quality_lora_strength = float(g.get("quality_lora_strength", 0.8) or 0.8)
    if quality_lora:
        ql_name = _join(lora_prefix, quality_lora)
        wf["252"] = {"class_type": "LoraLoaderModelOnly",
                     "inputs": {"model": ["231", 0], "lora_name": ql_name,
                                "strength_model": quality_lora_strength}}
        model_ref = ["252", 0]
    # 2026-08-21 latent 二采样参数（修复中远景面部崩坏，社区 RunningHub 双采工作流实证）：
    # 第一遍在目标分辨率采样 -> 分离 AV latent，只放大视频 latent（音频不参与空间放大）
    # -> 重新合并 -> 第二遍低 denoise refine -> 解码输出。FL2VA 参考图由
    # ref_image_size=match 自动匹配放大后的 latent，无需手工放大。
    # second_upscaler: "latent"=官方 LatentUpscaleBy（现成，默认）；
    #                  "h3"=H3LatentUpscaleByJingchen573（32 像素对齐更稳，需集群安装）。
    steps = g.get("video_steps", default_video_steps)
    second_pass = bool(g.get("second_pass", False))
    second_scale = max(1.0, float(g.get("second_scale", 1.5) or 1.5))
    second_steps = int(g.get("second_steps", steps) or steps)
    second_denoise = min(1.0, max(0.1, float(g.get("second_denoise", 0.3) or 0.3)))
    second_upscaler = str(g.get("second_upscaler", "learned") or "learned").lower()
    learned_model = str(g.get("learned_model",
                                  (_kg.resolve_string("learned") or "minimax_h3_latent_upscaler_3d_bf16.safetensors")) or
                            (_kg.resolve_string("learned") or "minimax_h3_latent_upscaler_3d_bf16.safetensors"))
    if sampler_mode == "new":
        # 2026-09-02 new chain uses MiniMaxH3MultiRateSamplerEXPT8 (installed on AutoDL)
        # to separate video/audio step counts. outputs model/sampler/sigmas -> BasicGuider + SamplerCustomAdvanced.
        wf["241"] = {"class_type": "MiniMaxH3MultiRateSamplerEXPT8",
                     "inputs": {"model": model_ref, "av_latent": ["167", 1],
                                "video_steps": int(g.get("video_steps", default_video_steps) or default_video_steps),
                                "audio_steps": int(g.get("audio_steps", default_audio_steps) or default_audio_steps),
                                "shift_video": g.get("shift_video", 12),
                                "shift_audio": g.get("shift_audio", 3)}}
        wf["183"] = {"class_type": "BasicGuider",
                     "inputs": {"model": ["241", 0], "conditioning": ["167", 0]}}
        wf["188"] = {"class_type": "SamplerCustomAdvanced",
                     "inputs": {"noise": ["182", 0], "guider": ["183", 0],
                                "sampler": ["241", 1], "sigmas": ["241", 2],
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
            # 二采复用一采噪声种子（机智罗 V2：同一 RandomNoise 连两次采样，保动作细节）
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
            # 音频锁定（2026-08-22 怪尾音根因修复）：二采只精修视频，
            # 音频换回一采原始 latent，避免 KSampler 二次采样音频产生段首怪叫。
            wf["250"] = {"class_type": "LTXVSeparateAVLatent",
                         "inputs": {"av_latent": ["249", 0]}}
            wf["251"] = {"class_type": "LTXVConcatAVLatent",
                         "inputs": {"video_latent": ["250", 0],
                                    "audio_latent": ["242", 1]}}
            sample_out = "251"
        wf["189"] = {"class_type": "VAEDecode",
                     "inputs": {"samples": [sample_out, 0], "vae": ["234", 0]}}
        wf["190"] = {"class_type": "VAEDecodeAudio",
                     "inputs": {"samples": [sample_out, 0], "vae": ["235", 0]}}
        wf["240"] = {"class_type": "CreateVideo",
                     "inputs": {"images": ["189", 0], "audio": ["190", 0], "fps": 24, "audio_fps": 8}}
        wf["92"] = {"class_type": "SaveVideo",
                    "inputs": {"video": ["240", 0],
                               "filename_prefix": "视频/H3Studio-" + name,
                               "format": "auto", "codec": "auto"}}
    else:
        # 旧链路（仙宫云未升级 ComfyUI 兼容）：Sage 注意力补丁 + 多速率采样器
        _xb = ((resolution_node or "").strip().lower() == "xb")
        if _xb:
            wf["230"] = {"class_type": "XB_Sage_BlockSwap",
                         "inputs": {"model": model_ref, "sage_preset": "关闭",
                                    "blocks_to_swap": 50}}
        else:
            wf["230"] = {"class_type": "MiniMaxH3MemoryEfficientSageAttentionPatch",
                         "inputs": {"model": model_ref}}
        # 2026-09-02 restore MultiRate sampler for legacy(XGPU): separate video/audio step counts.
        # MiniMaxH3MultiRateSamplerEXPT8 inputs av_latent + video_steps/audio_steps/shift_video/shift_audio,
        # outputs model/sampler/sigmas -> BasicGuider + SamplerCustomAdvanced (audit confirmed node on XGPU).
        wf["241"] = {"class_type": "MiniMaxH3MultiRateSamplerEXPT8",
                     "inputs": {"model": ["230", 0], "av_latent": ["167", 1],
                                "video_steps": int(g.get("video_steps", default_video_steps) or default_video_steps),
                                "audio_steps": int(g.get("audio_steps", default_audio_steps) or default_audio_steps),
                                "shift_video": g.get("shift_video", 12),
                                "shift_audio": g.get("shift_audio", 3)}}
        wf["183"] = {"class_type": "BasicGuider",
                     "inputs": {"model": ["241", 0], "conditioning": ["167", 0]}}
        wf["188"] = {"class_type": "SamplerCustomAdvanced",
                     "inputs": {"noise": ["182", 0], "guider": ["183", 0],
                                "sampler": ["241", 1], "sigmas": ["241", 2],
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
            # 二采复用一采噪声种子（机智罗 V2：同一 RandomNoise 连两次采样，保动作细节）
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
            # 音频锁定（2026-08-22 怪尾音根因修复）：二采只精修视频，
            # 音频换回一采原始 latent，避免 KSampler 二次采样音频产生段首怪叫。
            wf["250"] = {"class_type": "LTXVSeparateAVLatent",
                         "inputs": {"av_latent": ["249", 0]}}
            wf["251"] = {"class_type": "LTXVConcatAVLatent",
                         "inputs": {"video_latent": ["250", 0],
                                    "audio_latent": ["242", 1]}}
            sample_out = "251"
        if ((resolution_node or "").strip().lower() == "xb"):
            wf["189"] = {"class_type": "XB_VAEDecode", "inputs": {"samples": [sample_out, 0], "vae": ["234", 0], "cleanup": "卸载显存模型"}}
        else:
            wf["189"] = {"class_type": "VAEDecode", "inputs": {"samples": [sample_out, 0], "vae": ["234", 0]}}
        wf["190"] = {"class_type": "VAEDecodeAudio", "inputs": {"samples": [sample_out, 0], "vae": ["235", 0]}}
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
        # 2026-08-21 Motion Context：ref_videos 输入期望 IMAGE 帧序列（24fps, 2-15s），
        # 不能用新版 LoadVideo（输出 VIDEO 类型，类型不匹配被 400 拦截）；
        # VHS_LoadVideo 输出 IMAGE 帧，配合 force_rate=24 与节点要求对齐。
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
        "length": dur * 24 + 3, "ref_image_size": "match",
    }
    for i in range(len(images)):
        ref_node["ref_images.ref_image_%d" % i] = [str(1000 + i), 0]
    for i in range(len(audios)):
        ref_node["ref_audios.ref_audio_%d" % i] = [str(2000 + i), 0]
    for i in range(len(videos)):
        ref_node["ref_videos.ref_video_%d" % i] = [str(3000 + i), 0]
    # --- 2026-09-01: resolution node (XB or core ResolutionSelector) ---
    # If resolution_node explicitly requested AND we have a usable ratio/MP, insert
    # a resolution-computing node and wire its width/height into node 167.
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
    if _rn == "xb":
        # XB-BOX custom node (仙宫云 only). Outputs Width/Height/Frames/FPS.
        wf["555"] = {"class_type": "XB_HailuoH3VideoParams", "inputs": {
            "aspect_ratio": _combo, "megapixels": _mp, "multiple": 32,
            "frames_display": "", "duration": dur,
            "fps": 24, "fps_float": 24.0}}
        ref_node["width"] = ["555", 0]
        ref_node["height"] = ["555", 1]
        ref_node["length"] = ["555", 2]
    wf["167"] = {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": ref_node}
    return wf
