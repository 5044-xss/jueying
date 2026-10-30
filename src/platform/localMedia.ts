import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { AppData, CasePack, CaseShot, LibraryAsset, MediaRef, Project, Shot } from '@/core/types'

const DB_NAME = 'jueying-media'
const STORE_NAME = 'files'
const LOCAL_PREFIX = 'local-media://'
const NATIVE_PREFIX = 'capacitor-media://'
const NATIVE_DIR = 'jueying-media'

export interface LocalRef {
  url: string
  path: string
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbPromise
}

async function idbPut(name: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) throw new Error('当前环境不支持本地文件存储')
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写入本地存储失败'))
    tx.onabort = () => reject(tx.error ?? new Error('写入本地存储已中止'))
  })
}

async function idbGet(name: string): Promise<Blob | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(name)
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
    request.onerror = () => resolve(null)
  })
}

async function idbDelete(name: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAllKeys()
    request.onsuccess = () => resolve(request.result.map(String))
    request.onerror = () => resolve([])
  })
}

export function extensionOf(nameOrUrl?: string | null): string | undefined {
  if (!nameOrUrl) return undefined
  const clean = nameOrUrl.split(/[?#]/)[0]
  const hit = /\.([a-z0-9]{1,8})$/i.exec(clean)
  return hit?.[1].toLowerCase()
}

export function extensionOfUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const fromQuery =
      parsed.searchParams.get('filename') ?? parsed.searchParams.get('file')
    if (fromQuery) return extensionOf(fromQuery)
  } catch {
    // 不是合法 URL，按普通路径处理
  }
  return extensionOf(url)
}

export function mimeExt(type: string): string | undefined {
  const value = type.toLowerCase()
  if (value === 'image/jpeg') return 'jpg'
  if (value === 'image/png') return 'png'
  if (value === 'image/webp') return 'webp'
  if (value === 'image/gif') return 'gif'
  if (value === 'audio/mpeg') return 'mp3'
  if (value === 'audio/wav' || value === 'audio/x-wav') return 'wav'
  if (value === 'audio/mp4') return 'm4a'
  if (value === 'video/mp4') return 'mp4'
  if (value === 'video/webm') return 'webm'
  return undefined
}

function cleanExt(ext?: string | null): string {
  return /^[a-z0-9]{1,8}$/i.test(String(ext || '')) ? String(ext).toLowerCase() : 'bin'
}

function safeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '') || `media-${Date.now()}`
}

export function localFileName(path?: string | null): string | null {
  if (!path?.startsWith(LOCAL_PREFIX)) return null
  const name = path.slice(LOCAL_PREFIX.length).replace(/[\\/]+/g, '')
  return name || null
}

function nativeFileName(path?: string | null): string | null {
  if (!path?.startsWith(NATIVE_PREFIX)) return null
  const name = path.slice(NATIVE_PREFIX.length).replace(/[\\/]+/g, '')
  return name || null
}

function nativePath(name: string): string {
  return `${NATIVE_DIR}/${name}`
}

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function fileNameFromDesktopUrl(url?: string | null): string | null {
  if (!url?.startsWith('jueying-media://')) return null
  try {
    const name = decodeURIComponent(new URL(url).pathname).split('/').pop()
    return name || null
  } catch {
    return null
  }
}

export async function saveLocalMedia(
  blob: Blob,
  id: string,
  ext: string,
): Promise<LocalRef> {
  const safe = safeId(id)
  const clean = cleanExt(ext)
  const name = `${safe}.${clean}`

  if (window.desktop?.media?.saveBuffer) {
    const url = await window.desktop.media.saveBuffer(await blob.arrayBuffer(), safe, clean)
    return { url, path: `${LOCAL_PREFIX}${name}` }
  }

  if (isNative()) {
    const data = await blobToBase64(blob)
    await Filesystem.writeFile({
      path: nativePath(name),
      data,
      directory: Directory.Data,
      recursive: true,
    })
    const { uri } = await Filesystem.getUri({
      path: nativePath(name),
      directory: Directory.Data,
    })
    return { url: Capacitor.convertFileSrc(uri), path: `${NATIVE_PREFIX}${name}` }
  }

  await idbPut(name, blob)
  return { url: URL.createObjectURL(blob), path: `${LOCAL_PREFIX}${name}` }
}

export async function downloadLocalMedia(
  remoteUrl: string,
  id: string,
  ext?: string | null,
): Promise<LocalRef> {
  const safe = safeId(id)
  const clean = cleanExt(ext ?? extensionOfUrl(remoteUrl) ?? 'mp4')

  if (window.desktop?.media?.save) {
    const url = await window.desktop.media.save(remoteUrl, safe, clean)
    return { url, path: `${LOCAL_PREFIX}${safe}.${clean}` }
  }

  if (isNative()) {
    const name = `${safe}.${clean}`
    await Filesystem.downloadFile({
      url: remoteUrl,
      path: nativePath(name),
      directory: Directory.Data,
      recursive: true,
    })
    const { uri } = await Filesystem.getUri({
      path: nativePath(name),
      directory: Directory.Data,
    })
    return { url: Capacitor.convertFileSrc(uri), path: `${NATIVE_PREFIX}${name}` }
  }

  const res = await fetch(remoteUrl)
  if (!res.ok) throw new Error(`下载失败：${res.status}`)
  const blob = await res.blob()
  return saveLocalMedia(blob, safe, clean)
}

export async function readLocalMedia(path: string): Promise<Blob | null> {
  const name = localFileName(path)
  if (!name) return null
  return idbGet(name)
}

export async function readMediaBlob(media: {
  url?: string
  path?: string
}): Promise<Blob | null> {
  const name = localFileName(media.path)
  if (window.desktop?.media?.read && (name || media.url?.startsWith('jueying-media://'))) {
    try {
      const url = media.url?.startsWith('jueying-media://')
        ? media.url
        : `jueying-media://local/${name}`
      const buffer = await window.desktop.media.read(url)
      return new Blob([buffer])
    } catch {
      // 尝试下一个来源
    }
  }

  if (isNative() && media.path) {
    const native = nativeFileName(media.path)
    if (native) {
      try {
        const result = await Filesystem.readFile({
          path: nativePath(native),
          directory: Directory.Data,
        })
        const text = typeof result.data === 'string' ? result.data : ''
        const binary = atob(text)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        return new Blob([bytes])
      } catch {
        // 尝试下一个来源
      }
    }
  }

  if (media.path) {
    const local = await readLocalMedia(media.path)
    if (local) return local
  }

  if (media.url) {
    try {
      const res = await fetch(media.url)
      if (res.ok) return await res.blob()
    } catch {
      // 无法读取时返回 null
    }
  }
  return null
}

export function collectLocalFiles(data: AppData): Set<string> {
  const files = new Set<string>()
  const addMedia = (media?: MediaRef | null) => {
    if (!media) return
    const local = localFileName(media.path) ?? nativeFileName(media.path)
    if (local) files.add(local)
    const legacy = fileNameFromDesktopUrl(media.url)
    if (legacy) files.add(legacy)
  }
  const addShot = (shot: Shot) => {
    shot.images.forEach(addMedia)
    shot.audios?.forEach(addMedia)
    addMedia(shot.firstFrame)
    addMedia(shot.lastFrame)
    const output = localFileName(shot.outputPath) ?? nativeFileName(shot.outputPath)
    if (output) files.add(output)
    const legacy = fileNameFromDesktopUrl(shot.output)
    if (legacy) files.add(legacy)
  }
  for (const project of data.projects) {
    project.assets?.forEach(addMedia)
    project.shots.forEach(addShot)
  }
  for (const asset of data.assets) addMedia(asset)
  for (const pack of data.cases) {
    for (const shot of pack.shots) {
      const path = shot.videoPath ?? shot.video
      const local = localFileName(path) ?? nativeFileName(path)
      if (local) files.add(local)
      const legacy = fileNameFromDesktopUrl(path)
      if (legacy) files.add(legacy)
    }
  }
  return files
}

export async function deleteLocalFiles(files: string[]): Promise<void> {
  if (!files.length) return
  if (window.desktop?.media?.delete) {
    try {
      await window.desktop.media.delete(files)
    } catch {
      // 本地文件已被移除时忽略
    }
    return
  }
  if (isNative()) {
    await Promise.all(
      files.map((name) =>
        Filesystem.deleteFile({ path: nativePath(name), directory: Directory.Data }).catch(
          () => {},
        ),
      ),
    )
    return
  }
  await Promise.all(files.map((name) => idbDelete(name)))
}

async function resolveBlobUrl(
  path: string,
  cache: Map<string, string | null>,
): Promise<string | undefined> {
  const name = localFileName(path)
  if (!name) return undefined
  if (!cache.has(name)) {
    const blob = await idbGet(name)
    cache.set(name, blob ? URL.createObjectURL(blob) : null)
  }
  return cache.get(name) ?? undefined
}

async function resolveNativeUrl(
  path: string,
  cache: Map<string, string | null>,
): Promise<string | undefined> {
  const name = nativeFileName(path)
  if (!name) return undefined
  if (!cache.has(name)) {
    try {
      const { uri } = await Filesystem.getUri({
        path: nativePath(name),
        directory: Directory.Data,
      })
      cache.set(name, Capacitor.convertFileSrc(uri))
    } catch {
      cache.set(name, null)
    }
  }
  return cache.get(name) ?? undefined
}

async function importDataUrl(media: MediaRef): Promise<MediaRef> {
  if (!media.url?.startsWith('data:')) return media
  try {
    const blob = await (await fetch(media.url)).blob()
    const ext = extensionOf(media.name) ?? mimeExt(blob.type) ?? 'bin'
    const saved = await saveLocalMedia(blob, media.id, ext)
    return { ...media, url: saved.url, path: saved.path }
  } catch {
    return media
  }
}

export async function hydrateLocalMedia(data: AppData): Promise<AppData> {
  const desktop = Boolean(window.desktop?.isDesktop)
  const native = !desktop && isNative()
  const web = !desktop && !native
  const blobCache = new Map<string, string | null>()
  const nativeCache = new Map<string, string | null>()

  const resolveUrl = async (path: string): Promise<string | undefined> => {
    if (desktop) {
      const name = localFileName(path)
      return name ? `jueying-media://local/${name}` : undefined
    }
    if (native) return resolveNativeUrl(path, nativeCache)
    if (web) return resolveBlobUrl(path, blobCache)
    return undefined
  }

  const fillMedia = async (media?: MediaRef | null): Promise<MediaRef | null | undefined> => {
    if (!media) return media
    const upgraded = await importDataUrl(media)
    if (desktop || !upgraded.path) return upgraded
    const url = await resolveUrl(upgraded.path)
    return url && url !== upgraded.url ? { ...upgraded, url } : upgraded
  }

  const projects: Project[] = []
  for (const project of data.projects) {
    const shots: Shot[] = []
    for (const shot of project.shots) {
      const images: MediaRef[] = []
      for (const media of shot.images) images.push((await fillMedia(media)) as MediaRef)
      let audios: MediaRef[] | undefined
      if (shot.audios) {
        audios = []
        for (const media of shot.audios) audios.push((await fillMedia(media)) as MediaRef)
      }
      const firstFrame = await fillMedia(shot.firstFrame)
      const lastFrame = await fillMedia(shot.lastFrame)
      let output = shot.output
      if (shot.outputPath) {
        const url = await resolveUrl(shot.outputPath)
        if (url) output = url
      }
      shots.push({
        ...shot,
        images,
        ...(audios ? { audios } : {}),
        firstFrame,
        lastFrame,
        output,
      })
    }
    let assets: MediaRef[] | undefined
    if (project.assets) {
      assets = []
      for (const media of project.assets) assets.push((await fillMedia(media)) as MediaRef)
    }
    projects.push({ ...project, ...(assets ? { assets } : {}), shots })
  }

  const assets = []
  for (const asset of data.assets) {
    assets.push((await fillMedia(asset)) as LibraryAsset)
  }

  const cases: CasePack[] = []
  for (const pack of data.cases) {
    const shots: CaseShot[] = []
    for (const shot of pack.shots) {
      let video = shot.video
      if (shot.videoPath) {
        const url = await resolveUrl(shot.videoPath)
        if (url) video = url
      }
      shots.push({ ...shot, video: video ?? null })
    }
    cases.push({ ...pack, shots })
  }

  return { ...data, projects, assets, cases }
}

export async function pruneLocalMedia(data: AppData): Promise<void> {
  if (window.desktop?.isDesktop) return
  const keep = collectLocalFiles(data)
  if (isNative()) {
    try {
      const { files } = await Filesystem.readdir({
        path: NATIVE_DIR,
        directory: Directory.Data,
      })
      const stale = files.map((file) => file.name).filter((name) => !keep.has(name))
      await deleteLocalFiles(stale)
    } catch {
      // 目录尚未创建
    }
    return
  }
  const keys = await idbKeys()
  const stale = keys.filter((name) => !keep.has(name))
  await Promise.all(stale.map((name) => idbDelete(name)))
}

export function requestPersistentStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return
  void navigator.storage.persist().catch(() => {})
}
