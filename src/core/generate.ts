import type { Aspect, MediaRef, Shot } from './types'
import { newId } from './id'
import { ComfyClient, ComfySubmitError, type HistoryEntry, type HistoryOutput } from './comfy'
import { downloadLocalMedia, extensionOf } from '@/platform/localMedia'

export interface Caps {
  hasMultirate: boolean
  hasSageBlockswap: boolean
  hasSagePatch: boolean
  hasSaveVideo: boolean
  hasVhs: boolean
  hasXbResolution: boolean
  hasUpscaler3d: boolean
}

const DEFAULT_CAPS: Caps = {
  hasMultirate: true,
  hasSageBlockswap: false,
  hasSagePatch: true,
  hasSaveVideo: false,
  hasVhs: true,
  hasXbResolution: false,
  hasUpscaler3d: true,
}

const H3 = {
  unetFl2va: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  unetRef2va: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  lora: 'minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  vaeVideo: 'minimax_h3_video_vae_fp16.safetensors',
  vaeAudio: 'minimax_h3_audio_vae_fp32.safetensors',
}

const FRAME_GRID = 17
const FRAME_OFFSET = 5
const FRAME_MIN = 124
const MAX_MP = 0.98

type Node = { class_type: string; inputs: Record<string, unknown> }
type Workflow = Record<string, Node>

function snapLength(frames: number): number {
  const k = Math.round((frames - FRAME_OFFSET) / FRAME_GRID)
  return Math.max(FRAME_MIN, FRAME_GRID * k + FRAME_OFFSET)
}

function resolutionToWH(resolution: string, aspect: Aspect) {
  const mpTable: Record<string, number> = { '0.4': 0.4, '0.5': 0.5, '0.7': 0.7, '0.98': 0.98 }
  const ratioTable: Record<string, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
  }
  const native: Record<string, [number, number]> = {
    '16:9|0.4': [864, 480],
    '16:9|0.5': [960, 544],
    '9:16|0.4': [480, 864],
    '9:16|0.5': [544, 960],
  }
  const mp = Math.min(mpTable[resolution] ?? 0.5, MAX_MP)
  const hit = native[`${aspect}|${resolution}`]
  if (hit) return { width: hit[0], height: hit[1], megapixels: mp }
  const ratio = ratioTable[aspect] ?? 16 / 9
  const area = mp * 1_000_000
  const width = Math.max(256, Math.floor(Math.sqrt(area * ratio) / 32) * 32)
  const height = Math.max(256, Math.floor(Math.sqrt(area / ratio) / 32) * 32)
  return { width, height, megapixels: Number(((width * height) / 1_000_000).toFixed(3)) }
}

const RATIO_COMBO: Record<string, string> = {
  '1:1': '1:1 (Square)',
  '3:4': '3:4 (Portrait Standard)',
  '4:3': '4:3 (Standard)',
  '9:16': '9:16 (Portrait Widescreen)',
  '16:9': '16:9 (Widescreen)',
  '21:9': '21:9 (Ultrawide)',
}

function safeName(text: string): string {
  return (text || 'shot').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 40)
}

export function normalizeMentions(prompt: string): string {
  return prompt
    .replace(/@(?:图片|图|image|pic)\s*#?(\d+)/gi, (_, n) => `<Picture ${Number(n)}>`)
    .replace(/@\s*#?(\d+)/g, (_, n) => `<Picture ${Number(n)}>`)
}

function appendFrameNotes(prompt: string, firstNo: number, lastNo: number): string {
  if (!firstNo && !lastNo) return prompt
  const lines = ['参考帧说明：']
  if (firstNo) lines.push(`<Picture ${firstNo}> 是本段视频的首帧，画面必须从这一帧开始。`)
  if (lastNo) lines.push(`<Picture ${lastNo}> 是本段视频的尾帧，画面必须结束于这一帧。`)
  const note = lines.join('\n')
  const base = prompt.trim()
  return base ? `${base}\n${note}` : note
}

export function capsFromObjectInfo(info: Record<string, unknown>): Caps {
  const nodes = new Set(Object.keys(info || {}))
  return {
    hasMultirate: nodes.has('MiniMaxH3MultiRateSamplerEXPT8'),
    hasSageBlockswap: nodes.has('XB_Sage_BlockSwap'),
    hasSagePatch: nodes.has('MiniMaxH3MemoryEfficientSageAttentionPatch'),
    hasSaveVideo: nodes.has('SaveVideo') && nodes.has('CreateVideo'),
    hasVhs: nodes.has('VHS_VideoCombine'),
    hasXbResolution: nodes.has('XB_HailuoH3VideoParams'),
    hasUpscaler3d: nodes.has('MinimaxH3LatentUpscaler3D'),
  }
}

const infoCache = new Map<string, Record<string, unknown>>()

async function getNodeInfo(client: ComfyClient): Promise<Record<string, unknown>> {
  const key = client.baseUrl
  const cached = infoCache.get(key)
  if (cached) return cached
  try {
    const info = await client.objectInfo()
    infoCache.set(key, info)
    return info
  } catch {
    infoCache.set(key, {})
    return {}
  }
}

type InputSpec = [unknown, Record<string, unknown>?]

function nodeInputSpec(
  info: Record<string, unknown>,
  classType: string,
  field: string,
): InputSpec | undefined {
  const meta = info[classType] as
    | { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
    | undefined
  const spec = meta?.input?.required?.[field] ?? meta?.input?.optional?.[field]
  return Array.isArray(spec) ? (spec as InputSpec) : undefined
}

function comboValues(
  info: Record<string, unknown>,
  classType: string,
  field: string,
): string[] {
  const spec = nodeInputSpec(info, classType, field)
  const type = spec?.[0]
  return Array.isArray(type) ? type.map(String) : []
}

function specDefault(spec: unknown): unknown {
  if (!Array.isArray(spec) || !spec.length) return undefined
  const opts = spec[1] as Record<string, unknown> | undefined
  if (opts && 'default' in opts) return opts.default
  return Array.isArray(spec[0]) && spec[0].length ? spec[0][0] : undefined
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() || path).toLowerCase()
}

const LORA_PRIORITY = [
  '8step_v1.0',
  '4step_v1.1',
  '4step_v1.0',
  'lightx2v_turbo_4step',
  '4step',
  'turbo',
]

function loraRank(name: string): number {
  const low = name.toLowerCase()
  const hit = LORA_PRIORITY.findIndex((kw) => low.includes(kw))
  return hit === -1 ? 99 : hit
}

function pickModelFile(input: string, current: string, valid: string[]): string | null {
  if (!valid.length) return null
  const currentBase = baseName(current)
  const same = valid.find((v) => baseName(v) === currentBase)
  if (same) return same

  const low = (v: string) => v.toLowerCase()
  if (input === 'lora_name') {
    const cands = valid.filter((v) => low(v).includes('fl2v') && low(v).includes('turbo'))
    if (!cands.length) return null
    return cands.sort((a, b) => loraRank(a) - loraRank(b))[0]
  }
  if (input === 'unet_name') {
    if (currentBase.includes('ref2va')) {
      return valid.find((v) => low(v).includes('ref2va')) ?? null
    }
    const fl = valid.filter((v) => low(v).includes('fl2va') || low(v).includes('fl2v'))
    if (fl.length) {
      return fl.sort(
        (a, b) =>
          (low(a).includes('pruned') ? 0 : 1) - (low(b).includes('pruned') ? 0 : 1) ||
          a.length - b.length,
      )[0]
    }
    return (
      valid.find((v) => low(v).includes('minimax_h3') && !low(v).includes('ref2va')) ?? null
    )
  }
  if (input === 'clip_name') {
    for (const kw of ['qwen3vl_32b_minimax_h3', 'qwen3vl_32b', 'qwen3vl', 'minimax_h3']) {
      const hit = valid.find((v) => low(v).includes(kw))
      if (hit) return hit
    }
    return null
  }
  if (input === 'vae_name') {
    const kws = currentBase.includes('audio')
      ? ['minimax_h3_audio_vae', 'minimax_h3']
      : ['minimax_h3_video_vae', 'minimax_h3']
    for (const kw of kws) {
      const hit = valid.find((v) => low(v).includes(kw))
      if (hit) return hit
    }
    return null
  }
  return null
}

const FILE_INPUTS = ['unet_name', 'lora_name', 'clip_name', 'vae_name', 'model_name']

function applyNodeInfo(wf: Workflow, info: Record<string, unknown>): Workflow {
  if (!Object.keys(info).length) return wf
  const out: Workflow = {}
  for (const [nodeId, node] of Object.entries(wf)) {
    const meta = info[node.class_type] as
      | {
          input?: {
            required?: Record<string, unknown>
            optional?: Record<string, unknown>
          }
        }
      | undefined
    if (!meta?.input) {
      out[nodeId] = node
      continue
    }
    const required = meta.input.required ?? {}
    const optional = meta.input.optional ?? {}
    const known = new Set([...Object.keys(required), ...Object.keys(optional)])
    const inputs: Record<string, unknown> = { ...node.inputs }

    for (const key of Object.keys(inputs)) {
      if (known.has(key) || Array.isArray(inputs[key]) || key.includes('.')) continue
      delete inputs[key]
    }
    for (const [key, spec] of Object.entries(required)) {
      if (key in inputs) continue
      const dv = specDefault(spec)
      if (dv !== undefined) inputs[key] = dv
    }
    for (const field of FILE_INPUTS) {
      const cur = inputs[field]
      if (typeof cur !== 'string') continue
      const valid = comboValues(info, node.class_type, field)
      if (!valid.length || valid.includes(cur)) continue
      const picked = pickModelFile(field, cur, valid)
      if (picked) inputs[field] = picked
    }
    out[nodeId] = { class_type: node.class_type, inputs }
  }
  return out
}

function healModelInputs(wf: Workflow, rawBody: string): Workflow | null {
  let data: {
    node_errors?: Record<
      string,
      { errors?: { type?: string; extra_info?: { input_name?: string; input_config?: unknown } }[] }
    >
  }
  try {
    data = JSON.parse(rawBody)
  } catch {
    return null
  }
  const nodeErrors = data.node_errors
  if (!nodeErrors || typeof nodeErrors !== 'object') return null

  const healed: Workflow = JSON.parse(JSON.stringify(wf)) as Workflow
  let changed = false
  for (const [nodeId, err] of Object.entries(nodeErrors)) {
    for (const item of err?.errors ?? []) {
      if (item?.type !== 'value_not_in_list') continue
      const field = item.extra_info?.input_name
      const config = item.extra_info?.input_config
      const valid =
        Array.isArray(config) && Array.isArray(config[0]) ? config[0].map(String) : []
      if (!field || !valid.length) continue
      const inputs = healed[nodeId]?.inputs
      if (!inputs) continue
      const cur = inputs[field]
      if (typeof cur !== 'string') continue
      const picked = pickModelFile(field, cur, valid)
      if (picked && picked !== cur) {
        inputs[field] = picked
        changed = true
      }
    }
  }
  return changed ? healed : null
}

function friendlyNodeErrors(rawBody: string): string {
  let data: {
    node_errors?: Record<
      string,
      {
        class_type?: string
        errors?: {
          type?: string
          message?: string
          extra_info?: { input_name?: string; received_value?: unknown }
        }[]
      }
    >
  }
  try {
    data = JSON.parse(rawBody)
  } catch {
    return ''
  }
  const nodeErrors = data.node_errors
  if (!nodeErrors) return ''
  const parts: string[] = []
  for (const [nodeId, err] of Object.entries(nodeErrors)) {
    for (const item of err?.errors ?? []) {
      const cls = err?.class_type || ''
      const field = item.extra_info?.input_name || ''
      if (item?.type === 'value_not_in_list') {
        parts.push(
          `节点${nodeId}(${cls}) 的 ${field}='${String(item.extra_info?.received_value ?? '')}' 不在云端可用列表`,
        )
      } else if (field) {
        parts.push(`节点${nodeId}(${cls}) ${field}：${item.message || item.type || '错误'}`)
      } else {
        parts.push(`节点${nodeId}(${cls})：${item.message || item.type || '错误'}`)
      }
    }
  }
  return parts.join('；')
}

export function buildWorkflow(opts: {
  prompt: string
  name: string
  images: string[]
  audios: string[]
  duration: number
  aspect: Aspect
  resolution: string
  seed?: number | null
  caps: Caps
}): Workflow {
  const { images, audios, caps } = opts
  const duration = Math.min(15, Math.max(4, Math.round(opts.duration || 10)))
  const { width, height, megapixels } = resolutionToWH(opts.resolution, opts.aspect)
  const seed = opts.seed && opts.seed > 0 ? Math.floor(opts.seed) : 1 + Math.floor(Math.random() * 1_000_000_000)
  const useRef2va = audios.length > 0
  const unet = useRef2va ? H3.unetRef2va : H3.unetFl2va
  const length = snapLength(duration * 24 + 3)
  const wf: Workflow = {
    '182': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '232': { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    '231': {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['232', 0], lora_name: H3.lora, strength_model: 1.0 },
    },
    '233': { class_type: 'CLIPLoader', inputs: { clip_name: H3.clip, type: 'minimax', device: 'default' } },
    '234': { class_type: 'VAELoader', inputs: { vae_name: H3.vaeVideo } },
    '235': { class_type: 'VAELoader', inputs: { vae_name: H3.vaeAudio } },
    '209': { class_type: 'PrimitiveStringMultiline', inputs: { value: opts.prompt } },
  }

  let modelRef: [string, number] = ['231', 0]
  if (caps.hasSageBlockswap) {
    wf['230'] = {
      class_type: 'XB_Sage_BlockSwap',
      inputs: { model: modelRef, sage_preset: 'Nvidia-Sage', blocks_to_swap: 50 },
    }
    modelRef = ['230', 0]
  } else if (caps.hasSagePatch) {
    wf['230'] = {
      class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch',
      inputs: { model: modelRef },
    }
    modelRef = ['230', 0]
  }

  const steps = 8
  if (caps.hasMultirate) {
    wf['241'] = {
      class_type: 'MiniMaxH3MultiRateSamplerEXPT8',
      inputs: {
        model: modelRef,
        av_latent: ['167', 1],
        video_steps: steps,
        audio_steps: steps,
        shift_video: 12,
        shift_audio: 3,
      },
    }
    wf['183'] = { class_type: 'BasicGuider', inputs: { model: ['241', 0], conditioning: ['167', 0] } }
    wf['188'] = {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['182', 0],
        guider: ['183', 0],
        sampler: ['241', 1],
        sigmas: ['241', 2],
        latent_image: ['167', 1],
      },
    }
  } else {
    wf['236'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } }
    wf['238'] = {
      class_type: 'BasicScheduler',
      inputs: { model: modelRef, steps, scheduler: 'simple', denoise: 1.0 },
    }
    wf['183'] = { class_type: 'BasicGuider', inputs: { model: modelRef, conditioning: ['167', 0] } }
    wf['188'] = {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['182', 0],
        guider: ['183', 0],
        sampler: ['236', 0],
        sigmas: ['238', 0],
        latent_image: ['167', 1],
      },
    }
  }

  wf['189'] = { class_type: 'VAEDecode', inputs: { samples: ['188', 0], vae: ['234', 0] } }
  wf['190'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['188', 0], vae: ['235', 0] } }

  const prefix = `jueying/${safeName(opts.name)}`
  if (caps.hasSaveVideo) {
    wf['240'] = {
      class_type: 'CreateVideo',
      inputs: { images: ['189', 0], audio: ['190', 0], fps: 24 },
    }
    wf['92'] = {
      class_type: 'SaveVideo',
      inputs: { video: ['240', 0], filename_prefix: prefix, format: 'auto' },
    }
  } else {
    wf['237'] = {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['189', 0],
        audio: ['190', 0],
        frame_rate: 24,
        loop_count: 0,
        filename_prefix: prefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    }
  }

  images.forEach((img, i) => {
    wf[String(1000 + i)] = { class_type: 'LoadImage', inputs: { image: img } }
  })
  audios.forEach((aud, i) => {
    wf[String(2000 + i)] = { class_type: 'LoadAudio', inputs: { audio: aud } }
  })

  const refNode: Record<string, unknown> = {
    clip: ['233', 0],
    vae: ['234', 0],
    audio_vae: ['235', 0],
    prompt: ['209', 0],
    width,
    height,
    length,
    ref_image_size: 'match',
  }
  images.forEach((_, i) => {
    refNode[`ref_images.ref_image_${i}`] = [String(1000 + i), 0]
  })
  audios.forEach((_, i) => {
    refNode[`ref_audios.ref_audio_${i}`] = [String(2000 + i), 0]
  })

  if (caps.hasXbResolution) {
    wf['555'] = {
      class_type: 'XB_HailuoH3VideoParams',
      inputs: {
        aspect_ratio: RATIO_COMBO[opts.aspect] ?? RATIO_COMBO['16:9'],
        megapixels,
        multiple: 32,
        duration,
        scale_factor: 1.0,
      },
    }
    refNode.width = ['555', 0]
    refNode.height = ['555', 1]
    refNode.length = ['555', 2]
  }

  wf['167'] = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: refNode }
  return wf
}

function remoteName(uploaded: { name: string; subfolder: string }): string {
  return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name
}

async function mediaToFile(media: MediaRef, kind: 'image' | 'audio'): Promise<File> {
  if (!media.url) throw new Error(`素材「${media.name}」缺少文件内容，请重新上传`)
  const fallback = kind === 'audio' ? 'mp3' : 'png'
  if (media.url.startsWith('jueying-media://') && window.desktop?.media?.read) {
    const data = await window.desktop.media.read(media.url)
    const ext = media.url.split('.').pop()?.toLowerCase() || fallback
    return new File([data], media.name || `${media.id}.${ext}`)
  }
  const res = await fetch(media.url)
  if (!res.ok) throw new Error(`读取素材「${media.name}」失败`)
  const blob = await res.blob()
  return new File([blob], media.name || `${media.id}.${fallback}`, { type: blob.type || undefined })
}

async function uploadMedia(
  client: ComfyClient,
  media: MediaRef,
  kind: 'image' | 'audio',
): Promise<string> {
  const file = await mediaToFile(media, kind)
  return remoteName(await client.upload(file, kind))
}

function pickVideo(outputs: HistoryOutput[]): HistoryOutput | undefined {
  return outputs.find((o) => /\.(mp4|webm|mov|mkv)$/i.test(o.filename))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface RunShotOptions {
  client: ComfyClient
  endpointId?: string
  shot: Shot
  images: MediaRef[]
  audios: MediaRef[]
  firstFrame?: MediaRef | null
  lastFrame?: MediaRef | null
  update: (patch: Partial<Shot>) => void
  toast: (text: string, kind?: 'ok' | 'err') => void
}

interface PollContext {
  client: ComfyClient
  promptId: string
  clientId?: string
  initialProgress?: number
  shotId: string
  update: (patch: Partial<Shot>) => void
  toast: (text: string, kind?: 'ok' | 'err') => void
}

const cancelRequests = new Set<string>()

async function stopRemoteJob(client: ComfyClient, promptId: string): Promise<void> {
  try {
    await client.queueDelete([promptId])
  } catch {
    // 任务可能已经开始执行
  }
  try {
    const queue = await client.queue()
    if (queue.running.includes(promptId)) await client.interrupt()
  } catch {
    // 远端无人应答时保持本地取消结果
  }
}

export async function cancelShotJob(opts: {
  client: ComfyClient
  shot: Shot
  update: (patch: Partial<Shot>) => void
  toast: (text: string, kind?: 'ok' | 'err') => void
}): Promise<void> {
  const { client, shot, update, toast } = opts
  cancelRequests.add(shot.id)
  update({
    state: 'cancelled',
    progress: undefined,
    error: undefined,
    finishedAt: Date.now(),
  })
  toast('已取消生成')
  if (!shot.promptId) return
  await stopRemoteJob(client, shot.promptId)
}

function takeCancelRequest(shotId: string): boolean {
  return cancelRequests.delete(shotId)
}

async function pollForOutput(
  { client, promptId, clientId, initialProgress, shotId, update, toast }: PollContext,
  detectMissing = false,
): Promise<void> {
  let runningNow = false
  let lastPct = initialProgress ?? 0
  let disposed = false
  const connection: { close: (() => void) | null } = { close: null }
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0

  // 移动端切后台或网络抖动会断开 WebSocket，断了就重连，避免进度永远停在旧值。
  const connect = () => {
    if (disposed) return
    const close = client.connectEvents(clientId ?? newId('job'), {
      onExecuting: (node, eventPromptId) => {
        if (!eventPromptId || eventPromptId !== promptId) return
        if (!node) return
        reconnectAttempts = 0
        runningNow = true
        update({ state: 'running' })
      },
      onProgress: (value, max, eventPromptId) => {
        if (!max) return
        if (eventPromptId && eventPromptId !== promptId) return
        if (!eventPromptId && !runningNow) return
        reconnectAttempts = 0
        runningNow = true
        const pct = Math.max(2, Math.min(99, Math.round((value / max) * 100)))
        if (pct <= lastPct) return
        lastPct = pct
        update({ state: 'running', progress: pct })
      },
      onClose: () => {
        close()
        if (connection.close === close) connection.close = null
        if (disposed || reconnectTimer || reconnectAttempts >= 100) return
        reconnectAttempts += 1
        const delay = Math.min(2500 * reconnectAttempts, 20_000)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delay)
      },
    })
    connection.close = close
  }
  connect()

  const deadline = Date.now() + 2 * 60 * 60 * 1000
  let errorStreak = 0
  let missingStreak = 0
  try {
    while (Date.now() < deadline) {
      if (takeCancelRequest(shotId)) {
        update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
        return
      }
      await sleep(2500)
      if (takeCancelRequest(shotId)) {
        update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
        return
      }
      let inQueue = false
      try {
        const queue = await client.queue()
        if (queue.pending.includes(promptId)) {
          runningNow = false
          inQueue = true
          update({ state: 'queued' })
        } else if (queue.running.includes(promptId)) {
          runningNow = true
          inQueue = true
          update({ state: 'running' })
        }
      } catch {
        // 队列查询失败不影响主体轮询
      }
      let entry: HistoryEntry | null = null
      try {
        entry = await client.history(promptId)
        errorStreak = 0
      } catch (err) {
        errorStreak += 1
        if (errorStreak >= 6) {
          throw new Error(`生成端无响应：${(err as Error).message}`)
        }
        continue
      }
      if (!entry) {
        missingStreak = inQueue ? 0 : missingStreak + 1
        if (detectMissing && missingStreak >= 5) {
          throw new Error('生成端已找不到该任务（实例可能已重启）')
        }
        continue
      }
      missingStreak = 0

      const video = pickVideo(entry.outputs)
      if (video) {
        const remote = client.viewUrl(video.filename, video.subfolder, video.type)
        let output = remote
        let outputPath: string | undefined
        update({ progress: 99 })
        try {
          const mediaId = `${shotId}-${Date.now().toString(36)}`
          const ext = extensionOf(video.filename) ?? extensionOf(remote) ?? 'mp4'
          const local = await downloadLocalMedia(remote, mediaId, ext)
          output = local.url
          outputPath = local.path
        } catch (err) {
          toast(`成片已生成，但未能保存到本地：${(err as Error).message}`, 'err')
        }
        update({
          state: 'success',
          progress: 100,
          output,
          outputPath,
          remoteOutput: remote,
          finishedAt: Date.now(),
        })
        if (outputPath) toast('成片已生成并保存到本地')
        return
      }
      if (entry.statusText === 'error') throw new Error('生成端执行失败')
      if (entry.completed) throw new Error('任务结束但未找到视频输出')
    }
    throw new Error('生成超时（超过 2 小时）')
  } finally {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    connection.close?.()
  }
}

export async function runShotJob(opts: RunShotOptions): Promise<void> {
  const { client, endpointId, shot, images, audios, firstFrame, lastFrame, update, toast } = opts
  cancelRequests.delete(shot.id)
  try {
    update({ state: 'queued', progress: undefined, error: undefined })
    const info = await getNodeInfo(client)
    const caps = Object.keys(info).length ? capsFromObjectInfo(info) : DEFAULT_CAPS

    const refImages = await Promise.all(images.map((m) => uploadMedia(client, m, 'image')))
    const refAudios = await Promise.all(audios.map((m) => uploadMedia(client, m, 'audio')))
    const firstRemote = firstFrame ? await uploadMedia(client, firstFrame, 'image') : null
    const lastRemote = lastFrame ? await uploadMedia(client, lastFrame, 'image') : null

    if (takeCancelRequest(shot.id)) {
      update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
      return
    }

    const ordered = [
      ...refImages,
      ...(firstRemote ? [firstRemote] : []),
      ...(lastRemote ? [lastRemote] : []),
    ]
    if (ordered.length > 8) throw new Error('参考图过多：参考图 + 首尾帧最多 8 张')

    const firstNo = firstRemote ? refImages.length + 1 : 0
    const lastNo = lastRemote ? refImages.length + (firstRemote ? 1 : 0) + 1 : 0
    const prompt = appendFrameNotes(normalizeMentions(shot.prompt), firstNo, lastNo)

    const workflow = applyNodeInfo(
      buildWorkflow({
        prompt,
        name: shot.name,
        images: ordered,
        audios: refAudios,
        duration: shot.params.duration,
        aspect: shot.params.aspect,
        resolution: shot.params.resolution,
        seed: shot.params.seed,
        caps,
      }),
      info,
    )

    let promptId: string
    const clientId = newId('job')
    try {
      promptId = await client.submit(workflow, clientId)
    } catch (err) {
      if (!(err instanceof ComfySubmitError) || err.status !== 400) throw err
      const healed = healModelInputs(workflow, err.body)
      if (!healed) throw new Error(friendlyNodeErrors(err.body) || err.message)
      try {
        promptId = await client.submit(healed, clientId)
      } catch (retryErr) {
        if (retryErr instanceof ComfySubmitError) {
          throw new Error(friendlyNodeErrors(retryErr.body) || retryErr.message)
        }
        throw retryErr
      }
    }
    // 提交后先保持排队，等 ComfyUI 真正开始执行再切到生成中。
    update({
      promptId,
      clientId,
      state: 'queued',
      progress: undefined,
      ...(endpointId ? { endpointId } : {}),
    })
    if (takeCancelRequest(shot.id)) {
      await stopRemoteJob(client, promptId)
      update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
      return
    }
    await pollForOutput({
      client,
      promptId,
      clientId,
      initialProgress: 0,
      shotId: shot.id,
      update,
      toast,
    })
  } catch (err) {
    if (takeCancelRequest(shot.id)) {
      update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    update({ state: 'error', error: message, finishedAt: Date.now() })
    toast(`生成失败：${message}`, 'err')
  }
}

export interface ResumeShotOptions {
  client: ComfyClient
  shot: Shot
  update: (patch: Partial<Shot>) => void
  toast: (text: string, kind?: 'ok' | 'err') => void
}

export async function resumeShotJob(opts: ResumeShotOptions): Promise<void> {
  const { client, shot, update, toast } = opts
  if (!shot.promptId) return
  try {
    await pollForOutput(
      {
        client,
        promptId: shot.promptId,
        clientId: shot.clientId,
        initialProgress: Math.min(shot.progress ?? 0, 99),
        shotId: shot.id,
        update,
        toast,
      },
      true,
    )
  } catch (err) {
    if (takeCancelRequest(shot.id)) {
      update({ state: 'cancelled', progress: undefined, finishedAt: Date.now() })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    update({ state: 'error', error: message, finishedAt: Date.now() })
    toast(`恢复任务失败：${message}`, 'err')
  }
}
