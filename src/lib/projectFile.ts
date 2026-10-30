import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  PackSchema,
  packToProject,
  projectToPack,
  type Pack,
  type PackVideoMap,
} from '@/core/manifest'
import type { Project } from '@/core/types'
import {
  extensionOf,
  extensionOfUrl,
  mimeExt,
  readMediaBlob,
  saveLocalMedia,
} from '@/platform/localMedia'

const MANIFEST_NAME = 'jueying.json'

export interface ImportedPack {
  pack: Pack
  videos: PackVideoMap
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadProjectFile(project: Project): Promise<void> {
  const pack = projectToPack(project)
  const files: Record<string, Uint8Array> = {}

  for (const [index, shot] of project.shots.entries()) {
    if (!shot.output) continue
    const blob = await readMediaBlob({ url: shot.output, path: shot.outputPath })
    if (!blob) continue
    const ext =
      extensionOf(shot.outputPath) ??
      extensionOfUrl(shot.output) ??
      mimeExt(blob.type) ??
      'mp4'
    const path = `media/video-${String(index + 1).padStart(2, '0')}.${ext}`
    files[path] = new Uint8Array(await blob.arrayBuffer())
    const target = pack.shots[index]
    if (target) target.video = path
  }

  files[MANIFEST_NAME] = strToU8(JSON.stringify(pack, null, 2))
  const data = zipSync(files, { level: 0 })
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer
  downloadBlob(new Blob([buffer], { type: 'application/zip' }), `${project.name}.jueying.zip`)
}

function manifestKey(entries: Record<string, Uint8Array>): string | undefined {
  const keys = Object.keys(entries)
  return (
    keys.find((key) => key.split('/').pop()?.toLowerCase() === MANIFEST_NAME) ??
    keys.find((key) => key.toLowerCase().endsWith('.json'))
  )
}

export async function readPackFile(file: File): Promise<ImportedPack> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json')) {
    const pack = PackSchema.parse(JSON.parse(await file.text()))
    return { pack, videos: new Map() }
  }
  if (!name.endsWith('.zip')) {
    throw new Error('请选择 .jueying.zip 或 .jueying.json 文件')
  }

  const data = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    throw new Error('压缩包无法读取')
  }
  const key = manifestKey(entries)
  const raw = key ? entries[key] : undefined
  if (!raw) throw new Error('压缩包里没有 jueying.json')

  const pack = PackSchema.parse(JSON.parse(strFromU8(raw)))
  const videos: PackVideoMap = new Map()
  for (const [index, shot] of pack.shots.entries()) {
    const ref = shot.video?.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!ref || /^(https?:|blob:|data:)/i.test(ref)) continue
    const entry =
      entries[ref] ??
      entries[ref.split('/').pop() ?? ''] ??
      Object.entries(entries).find(([path]) => path.endsWith(`/${ref}`))?.[1]
    if (!entry) continue
    const ext = extensionOf(ref) ?? 'mp4'
    const saved = await saveLocalMedia(
      new Blob([entry.slice().buffer as ArrayBuffer]),
      `pack-${Date.now().toString(36)}-${index}`,
      ext,
    )
    videos.set(shot.video as string, saved)
  }

  return { pack, videos }
}

export async function readProjectFile(file: File): Promise<Project> {
  const { pack, videos } = await readPackFile(file)
  return packToProject(pack, videos)
}
