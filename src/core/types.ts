export type ShotState = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type Aspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

export interface ShotParams {
  aspect: Aspect
  duration: number
  resolution: string
  seed?: number | null
  steps?: number
  blocks?: number
}

export interface MediaRef {
  id: string
  name: string
  /** 预览用 data URL（原型阶段） */
  url?: string
  /** 远端文件名或本地路径 */
  path?: string
}

export interface Shot {
  id: string
  projectId: string
  name: string
  prompt: string
  params: ShotParams
  state: ShotState
  /** ComfyUI 返回的 prompt_id，任务恢复的唯一凭据 */
  promptId?: string
  /** 提交任务时使用的 ComfyUI 客户端 ID，用于接收进度事件 */
  clientId?: string
  /** 提交任务时使用的生成端，用于刷新后恢复任务 */
  endpointId?: string
  progress?: number
  output?: string
  /** 云端成片地址，本地缓存丢失时用于重新下载 */
  remoteOutput?: string
  /** 本地成片文件名（用于重启后恢复预览与清理） */
  outputPath?: string
  error?: string
  images: MediaRef[]
  audios?: MediaRef[]
  firstFrame?: MediaRef | null
  lastFrame?: MediaRef | null
  createdAt: number
  finishedAt?: number | null
}

export interface Project {
  id: string
  name: string
  origin: 'blank' | 'case' | 'import'
  defaultParams: ShotParams
  shots: Shot[]
  /** 项目级素材（手动上传，不依赖生成记录） */
  assets?: MediaRef[]
  createdAt: number
  updatedAt: number
}

export interface CaseShot {
  order: number
  name: string
  prompt: string
  params: Record<string, unknown>
  images: string[]
  firstFrame?: string | null
  lastFrame?: string | null
  /** 运行时播放地址 */
  video?: string | null
  /** 本地视频路径，用于重启后恢复播放 */
  videoPath?: string | null
}

export interface CasePack {
  id: string
  name: string
  author?: string
  version: string
  description?: string
  defaultParams: Record<string, unknown>
  shots: CaseShot[]
  importedAt: number
}

export interface Endpoint {
  id: string
  name: string
  url: string
  token?: string
  lastOk?: number
}

export type AssetKind = 'image' | 'audio' | 'video'

export interface LibraryAsset {
  id: string
  name: string
  kind: AssetKind
  url?: string
  path?: string
  sourceProjectId?: string
  sourceProjectName?: string
  createdAt: number
}

export interface AppData {
  schema: 1
  endpoints: Endpoint[]
  activeEndpointId?: string
  projects: Project[]
  cases: CasePack[]
  assets: LibraryAsset[]
}

export const DEFAULT_PARAMS: ShotParams = {
  aspect: '16:9',
  duration: 8,
  resolution: '0.5',
  seed: null,
  steps: 8,
  blocks: 50,
}

export function emptyData(): AppData {
  return { schema: 1, endpoints: [], projects: [], cases: [], assets: [] }
}
