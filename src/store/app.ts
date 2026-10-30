import { create } from 'zustand'
import type {
  AppData,
  CasePack,
  Endpoint,
  LibraryAsset,
  MediaRef,
  Project,
  Shot,
  ShotParams,
} from '@/core/types'
import { DEFAULT_PARAMS, emptyData } from '@/core/types'
import { newId } from '@/core/id'
import { loadData, saveData } from '@/platform/storage'
import {
  collectLocalFiles,
  deleteLocalFiles,
  hydrateLocalMedia,
  pruneLocalMedia,
  requestPersistentStorage,
} from '@/platform/localMedia'

export type Tab = 'gen' | 'projects' | 'library'
export type ToastKind = 'ok' | 'err'

export interface Toast {
  id: string
  text: string
  kind: ToastKind
}

interface AppState {
  ready: boolean
  data: AppData
  tab: Tab
  projectId: string | null
  genProjectId: string | null
  editingShot: { projectId: string; shotId: string } | null
  settingsOpen: boolean
  toasts: Toast[]

  hydrate: () => Promise<void>
  setTab: (tab: Tab) => void
  setGenProject: (id: string | null) => void
  openProject: (id: string) => void
  closeProject: () => void
  editShot: (projectId: string, shotId: string) => void
  clearEditingShot: () => void
  setSettingsOpen: (open: boolean) => void

  addEndpoint: (name: string, url: string, token?: string) => Endpoint
  removeEndpoint: (id: string) => void
  setActiveEndpoint: (id: string) => void
  touchEndpoint: (id: string) => void

  createProject: (name: string, params?: Partial<ShotParams>) => Project
  ensureDefaultProject: () => Project
  addProject: (project: Project) => void
  renameProject: (id: string, name: string) => void
  updateProject: (
    id: string,
    patch: { name?: string; defaultParams?: Partial<ShotParams> },
  ) => void
  copyProject: (id: string) => Project | null
  deleteProject: (id: string) => void
  addShot: (projectId: string, shot: Shot) => void
  addProjectAssets: (projectId: string, media: MediaRef[]) => void
  removeProjectAsset: (projectId: string, assetId: string) => void
  updateShot: (projectId: string, shotId: string, patch: Partial<Shot>) => void
  copyShot: (projectId: string, shotId: string) => void
  deleteShot: (projectId: string, shotId: string) => void

  addCase: (pack: CasePack) => void
  removeCase: (id: string) => void

  addAsset: (asset: LibraryAsset) => void
  removeAsset: (id: string) => void

  toast: (text: string, kind?: ToastKind) => void
  dismissToast: (id: string) => void
}

const initial: AppData = emptyData()

const VALID_RES = ['0.4', '0.5', '0.7', '0.98']
const normRes = (r: unknown): string =>
  typeof r === 'string' && VALID_RES.includes(r) ? r : '0.5'

function normalizeProject(raw: Project): Project {
  const defaultParams = { ...DEFAULT_PARAMS, ...raw.defaultParams }
  return {
    ...raw,
    defaultParams: { ...defaultParams, resolution: normRes(defaultParams.resolution) },
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    shots: Array.isArray(raw.shots)
      ? raw.shots.map((shot) => {
          const params = { ...DEFAULT_PARAMS, ...shot.params }
          return {
            ...shot,
            params: { ...params, resolution: normRes(params.resolution) },
          }
        })
      : [],
  }
}

function sanitize(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return initial
  const data = raw as Partial<AppData>
  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : []
  const endpoint =
    endpoints.find((item) => item.id === data.activeEndpointId) ?? endpoints[0]
  return {
    schema: 1,
    endpoints: endpoint ? [endpoint] : [],
    activeEndpointId: endpoint?.id,
    projects: Array.isArray(data.projects)
      ? (data.projects as Project[]).map(normalizeProject)
      : [],
    cases: Array.isArray(data.cases) ? data.cases : [],
    assets: Array.isArray(data.assets) ? data.assets : [],
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let hydrated = false
function scheduleSave(data: AppData) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveData(data)
  }, 250)
}

function saveNow(data: AppData) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void saveData(data)
}

function gcMedia(before: AppData, after: AppData) {
  const keep = collectLocalFiles(after)
  const stale = [...collectLocalFiles(before)].filter((name) => !keep.has(name))
  if (stale.length) void deleteLocalFiles(stale)
}

function cloneMedia(media: MediaRef): MediaRef {
  return { ...media, id: newId('media') }
}

function cloneShot(shot: Shot, projectId: string): Shot {
  const interrupted = shot.state === 'running' || shot.state === 'queued'
  return {
    ...shot,
    id: newId('shot'),
    projectId,
    params: { ...shot.params },
    state: interrupted ? 'cancelled' : shot.state,
    progress: interrupted ? undefined : shot.progress,
    promptId: interrupted ? undefined : shot.promptId,
    error: interrupted ? '复制时任务已中断' : shot.error,
    images: shot.images.map(cloneMedia),
    audios: shot.audios?.map(cloneMedia),
    firstFrame: shot.firstFrame ? cloneMedia(shot.firstFrame) : shot.firstFrame,
    lastFrame: shot.lastFrame ? cloneMedia(shot.lastFrame) : shot.lastFrame,
  }
}

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  data: initial,
  tab: 'gen',
  projectId: null,
  genProjectId: null,
  editingShot: null,
  settingsOpen: false,
  toasts: [],

  hydrate: async () => {
    if (hydrated) return
    hydrated = true
    const raw = await loadData()
    const data = await hydrateLocalMedia(sanitize(raw))
    set({ data, ready: true })
    requestPersistentStorage()
    void pruneLocalMedia(data)
    useApp.subscribe((state, prev) => {
      if (state.data !== prev.data) scheduleSave(state.data)
    })
  },

  setTab: (tab) => set({ tab, projectId: null }),
  setGenProject: (genProjectId) => set({ genProjectId, tab: 'gen', projectId: null }),
  openProject: (id) => set({ tab: 'projects', projectId: id }),
  closeProject: () => set({ projectId: null }),
  editShot: (projectId, shotId) =>
    set({
      tab: 'gen',
      projectId: null,
      genProjectId: projectId,
      editingShot: { projectId, shotId },
    }),
  clearEditingShot: () => set({ editingShot: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  addEndpoint: (name, url, token) => {
    const existing = get().data.endpoints[0]
    const endpoint: Endpoint = {
      id: existing?.id ?? newId('ep'),
      name: name.trim() || existing?.name || '生成端',
      url: url.trim(),
      token,
      lastOk: Date.now(),
    }
    set((s) => ({
      data: {
        ...s.data,
        endpoints: [endpoint],
        activeEndpointId: endpoint.id,
      },
    }))
    return endpoint
  },

  removeEndpoint: (id) => {
    set((s) => {
      const endpoints = s.data.endpoints.filter((e) => e.id !== id)
      return {
        data: {
          ...s.data,
          endpoints,
          activeEndpointId:
            s.data.activeEndpointId === id ? endpoints[0]?.id : s.data.activeEndpointId,
        },
      }
    })
  },

  setActiveEndpoint: (id) =>
    set((s) => ({ data: { ...s.data, activeEndpointId: id } })),

  touchEndpoint: (id) =>
    set((s) => ({
      data: {
        ...s.data,
        endpoints: s.data.endpoints.map((e) => (e.id === id ? { ...e, lastOk: Date.now() } : e)),
      },
    })),

  createProject: (name, params) => {
    const now = Date.now()
    const project: Project = {
      id: newId('proj'),
      name: name.trim() || '未命名项目',
      origin: 'blank',
      defaultParams: { ...DEFAULT_PARAMS, ...params },
      shots: [],
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({
      data: { ...s.data, projects: [project, ...s.data.projects] },
      tab: 'projects',
      projectId: project.id,
      genProjectId: project.id,
    }))
    return project
  },

  ensureDefaultProject: () => {
    const existing = get().data.projects[0]
    if (existing) {
      if (!get().genProjectId) set({ genProjectId: existing.id })
      return existing
    }
    const now = Date.now()
    const project: Project = {
      id: newId('proj'),
      name: '未命名项目',
      origin: 'blank',
      defaultParams: { ...DEFAULT_PARAMS },
      shots: [],
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({
      data: { ...s.data, projects: [project, ...s.data.projects] },
      genProjectId: project.id,
    }))
    return project
  },

  addProject: (project) =>
    set((s) => ({
      data: { ...s.data, projects: [project, ...s.data.projects] },
      tab: 'projects',
      projectId: project.id,
      genProjectId: project.id,
    })),

  renameProject: (id, name) =>
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p,
        ),
      },
    })),

  updateProject: (id, patch) =>
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                ...(patch.name !== undefined ? { name: patch.name.trim() || p.name } : {}),
                ...(patch.defaultParams
                  ? { defaultParams: { ...p.defaultParams, ...patch.defaultParams } }
                  : {}),
                updatedAt: Date.now(),
              }
            : p,
        ),
      },
    })),

  copyProject: (id) => {
    const source = get().data.projects.find((p) => p.id === id)
    if (!source) return null
    const now = Date.now()
    const projectId = newId('proj')
    const latest = source.shots[source.shots.length - 1]
    const project: Project = {
      ...source,
      id: projectId,
      name: `${source.name} 副本`,
      origin: 'blank',
      defaultParams: latest ? { ...latest.params } : { ...source.defaultParams },
      createdAt: now,
      updatedAt: now,
      assets: source.assets?.map(cloneMedia),
      shots: source.shots.map((shot) => cloneShot(shot, projectId)),
    }
    set((s) => ({ data: { ...s.data, projects: [project, ...s.data.projects] } }))
    return project
  },

  deleteProject: (id) => {
    const before = get().data
    set((s) => ({
      data: { ...s.data, projects: s.data.projects.filter((p) => p.id !== id) },
      projectId: s.projectId === id ? null : s.projectId,
    }))
    gcMedia(before, get().data)
  },

  addShot: (projectId, shot) => {
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === projectId
            ? { ...p, shots: [...p.shots, shot], updatedAt: Date.now() }
            : p,
        ),
      },
    }))
    saveNow(get().data)
  },

  addProjectAssets: (projectId, media) => {
    if (!media.length) return
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                assets: [...(p.assets ?? []), ...media],
                updatedAt: Date.now(),
              }
            : p,
        ),
      },
    }))
    saveNow(get().data)
  },

  removeProjectAsset: (projectId, assetId) => {
    const before = get().data
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                assets: (p.assets ?? []).filter((m) => m.id !== assetId),
                updatedAt: Date.now(),
              }
            : p,
        ),
      },
    }))
    gcMedia(before, get().data)
    saveNow(get().data)
  },

  updateShot: (projectId, shotId, patch) => {
    const touchesMedia =
      'output' in patch ||
      'outputPath' in patch ||
      'images' in patch ||
      'audios' in patch ||
      'firstFrame' in patch ||
      'lastFrame' in patch
    const before = touchesMedia ? get().data : null
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                updatedAt: Date.now(),
                shots: p.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
              }
            : p,
        ),
      },
    }))
    if (before) gcMedia(before, get().data)
    if (
      patch.promptId ||
      (patch.state && patch.state !== 'queued' && patch.state !== 'running')
    ) {
      saveNow(get().data)
    }
  },

  copyShot: (projectId, shotId) =>
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) => {
          if (p.id !== projectId) return p
          const source = p.shots.find((shot) => shot.id === shotId)
          if (!source) return p
          const copy = { ...cloneShot(source, projectId), name: `${source.name} 副本` }
          return {
            ...p,
            defaultParams: { ...p.defaultParams, ...source.params },
            shots: [...p.shots, copy],
            updatedAt: Date.now(),
          }
        }),
      },
    })),

  deleteShot: (projectId, shotId) => {
    const before = get().data
    set((s) => ({
      data: {
        ...s.data,
        projects: s.data.projects.map((p) =>
          p.id === projectId
            ? { ...p, shots: p.shots.filter((x) => x.id !== shotId), updatedAt: Date.now() }
            : p,
        ),
      },
    }))
    gcMedia(before, get().data)
  },

  addCase: (pack) =>
    set((s) => ({ data: { ...s.data, cases: [pack, ...s.data.cases] } })),

  removeCase: (id) => {
    const before = get().data
    set((s) => ({ data: { ...s.data, cases: s.data.cases.filter((c) => c.id !== id) } }))
    gcMedia(before, get().data)
    saveNow(get().data)
  },

  addAsset: (asset) =>
    set((s) => ({ data: { ...s.data, assets: [asset, ...s.data.assets] } })),

  removeAsset: (id) => {
    const before = get().data
    set((s) => ({ data: { ...s.data, assets: s.data.assets.filter((a) => a.id !== id) } }))
    gcMedia(before, get().data)
  },

  toast: (text, kind = 'ok') => {
    const item: Toast = { id: newId('toast'), text, kind }
    set((s) => ({ toasts: [...s.toasts, item] }))
    setTimeout(() => get().dismissToast(item.id), 2600)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function activeEndpoint(state: AppState): Endpoint | undefined {
  return state.data.endpoints.find((e) => e.id === state.data.activeEndpointId)
}
