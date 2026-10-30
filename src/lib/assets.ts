import type { AssetKind, LibraryAsset, MediaRef, Project } from '@/core/types'

const AUDIO_RE = /\.(mp3|wav|m4a|ogg|aac|flac)$/i
const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)$/i

export function mediaKind(name: string): AssetKind {
  if (AUDIO_RE.test(name)) return 'audio'
  if (VIDEO_RE.test(name)) return 'video'
  return 'image'
}

export function projectAssets(project: Project | undefined): MediaRef[] {
  if (!project) return []
  const map = new Map<string, MediaRef>()
  const add = (media: MediaRef) => {
    const key = media.path ?? media.url ?? media.id
    if (!map.has(key)) map.set(key, media)
  }
  for (const media of project.assets ?? []) add(media)
  for (const shot of project.shots) {
    for (const media of [
      ...shot.images,
      ...(shot.audios ?? []),
      ...(shot.firstFrame ? [shot.firstFrame] : []),
      ...(shot.lastFrame ? [shot.lastFrame] : []),
    ]) {
      add(media)
    }
  }
  return [...map.values()]
}

export function mediaToAsset(
  media: MediaRef,
  project?: Project,
): LibraryAsset {
  return {
    id: media.id,
    name: media.name,
    kind: mediaKind(media.name),
    url: media.url,
    path: media.path,
    sourceProjectId: project?.id,
    sourceProjectName: project?.name,
    createdAt: Date.now(),
  }
}

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
}
