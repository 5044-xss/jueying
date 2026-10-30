import type { AppData, LibraryAsset, MediaRef } from '@/core/types'
import type { LicenseBridge } from '@/license/types'

export interface DesktopBridge {
  isDesktop: boolean
  version: () => Promise<string>
  store: {
    load: () => Promise<unknown>
    save: (data: unknown) => Promise<boolean>
  }
  media?: {
    save: (url: string, id: string, ext?: string) => Promise<string>
    saveBuffer: (data: ArrayBuffer, id: string, ext: string) => Promise<string>
    delete: (files: string[]) => Promise<number>
    reveal: (url: string) => Promise<boolean>
    open: (url: string) => Promise<boolean>
    read: (url: string) => Promise<ArrayBuffer>
  }
  license?: LicenseBridge
  dataPath?: () => Promise<string>
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

const LOCAL_KEY = 'jueying.data.v1'

export const isDesktop = typeof window !== 'undefined' && Boolean(window.desktop?.isDesktop)

export async function loadData(): Promise<unknown> {
  if (window.desktop?.store) {
    try {
      return await window.desktop.store.load()
    } catch {
      return null
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const RUNTIME_URL = /^(blob:|data:)|_capacitor_file_/i

// blob:/data: 只在当前会话有效；持久化时剔除，靠 path 在下次启动时重新解析。
function stripMedia(media: MediaRef | null | undefined): MediaRef | null | undefined {
  if (!media) return media
  if (!media.url || !RUNTIME_URL.test(media.url)) return media
  const { url: _url, ...rest } = media
  return rest
}

function stripAsset(asset: LibraryAsset): LibraryAsset {
  if (!asset.url || !RUNTIME_URL.test(asset.url)) return asset
  const { url: _url, ...rest } = asset
  return rest
}

function persistable(data: AppData): AppData {
  return {
    ...data,
    projects: data.projects.map((project) => ({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        ...(shot.output && RUNTIME_URL.test(shot.output) ? { output: undefined } : {}),
        images: shot.images.map((m) => stripMedia(m) as MediaRef),
        audios: shot.audios?.map((m) => stripMedia(m) as MediaRef),
        firstFrame: stripMedia(shot.firstFrame),
        lastFrame: stripMedia(shot.lastFrame),
      })),
    })),
    assets: data.assets.map(stripAsset),
    cases: data.cases.map((pack) => ({
      ...pack,
      shots: pack.shots.map((shot) =>
        shot.videoPath ? { ...shot, video: undefined } : shot,
      ),
    })),
  }
}

export async function saveData(data: AppData): Promise<void> {
  const payload = persistable(data)
  if (window.desktop?.store) {
    await window.desktop.store.save(payload)
    return
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('保存失败', err)
  }
}
