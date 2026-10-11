// 与后端契约的类型定义（见 DESKTOP-PLAN.md 第 11 节）。

export type JobState = 'running' | 'queued' | 'success' | 'error' | 'cancelled'

export interface JobProgress {
  bytes: number
  total: number
}

export interface JobParams {
  duration?: number
  aspect?: string
  resolution?: string
  sampler_mode?: string
  resolution_node?: string
  firstNo?: number
  lastNo?: number
}

export interface JobInputs {
  images?: string[]
  audios?: string[]
  firstFrame?: string | null
  lastFrame?: string | null
}

export interface Job {
  id: string
  state: JobState
  message: string
  progress: JobProgress
  name: string
  promptId: string
  createdAt: number
  finishedAt: number | null
  error: string
  params: JobParams
  prompt: string
  inputs?: JobInputs
  project?: string
  videoUrl: string
}

export interface UpdateJobBody {
  name?: string
  project?: string
}

export interface CaseInfo {
  name: string
  hasCover: boolean
  shots: number
}

export interface CasesList {
  installed: boolean
  items: CaseInfo[]
}

export interface CasesInstallStatus {
  state: 'idle' | 'downloading' | 'done' | 'error'
  progress: number
  error: string
}

export interface CaseImportResult {
  ok: boolean
  project: string
  count: number
}

export type AssetKind = 'image' | 'audio'

export interface Asset {
  id: string
  kind: AssetKind
  name: string
  size: number
}

export interface Health {
  ok: boolean
  version: string
  configured: boolean
}

export type CloudType = 'xgpu' | 'autodl'
export type SamplerMode = '' | 'legacy' | 'new'
export type ModelVariant = 'auto' | 'fl2va' | 'ref2va'

export interface CloudConfig {
  name: string
  type: CloudType | string
  base_url: string
  ssh_host: string
  ssh_port: number
  ssh_user: string
  ssh_pass: string
  comfy_port: number
  api_base_url: string
  workflow_id: string
  token: string
  sampler_mode: SamplerMode | string
  model_prefix: string
  lora_prefix: string | null
  clip_name: string
  step_probe: boolean
}

export interface GenConfig {
  width: number
  height: number
  megapixels: number
  duration_max: number
  seed_auto: boolean
  seed: number
  video_steps: number
  audio_steps: number
  shift_video: number
  shift_audio: number
  second_pass: boolean
  second_scale: number
  second_denoise: number
  second_upscaler: string
  lora_strength: number
}

export interface Settings {
  cloud: CloudConfig
  models: Record<string, string>
  gen: GenConfig
  server: { host: string; port: number }
  output_dir: string
  asset_dir: string
  job_timeout_sec: number
}

export interface Catalog {
  nodes: string[]
  files: {
    unet: string[]
    clip: string[]
    lora: string[]
    vae: string[]
  }
  has_xb_resolution: boolean
  has_savevideo: boolean
  has_vhs: boolean
}

export interface TestResult {
  ok: boolean
  detail: string
  catalog?: Catalog
  catalog_error?: string
}

export type Aspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

export interface JobForm {
  title: string
  duration: number
  aspect: Aspect
  resolution: string
  seed: number
  samplerMode: '' | 'legacy' | 'new' | string
  modelVariant: ModelVariant
}

export interface CreateJobBody {
  prompt: string
  title?: string
  duration?: number
  aspect?: Aspect | string
  resolution?: string
  seed?: number
  images?: string[]
  audios?: string[]
  firstFrame?: string | null
  lastFrame?: string | null
  samplerMode?: string | null
  modelVariant?: ModelVariant
}
