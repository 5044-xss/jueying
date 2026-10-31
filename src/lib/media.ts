import { Capacitor } from '@capacitor/core'
import { Camera, MediaTypeSelection } from '@capacitor/camera'
import { Filesystem } from '@capacitor/filesystem'
import type { MediaResult, MediaResults } from '@capacitor/camera'
import { newId } from '@/core/id'
import type { MediaRef } from '@/core/types'
import { extensionOf, mimeExt, saveLocalMedia } from '@/platform/localMedia'

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function readMedia(file: File): Promise<MediaRef> {
  const id = newId('media')
  const ext =
    extensionOf(file.name) ??
    mimeExt(file.type) ??
    (file.type.startsWith('audio/') ? 'mp3' : 'png')
  try {
    const saved = await saveLocalMedia(file, id, ext)
    return { id, name: file.name, url: saved.url, path: saved.path }
  } catch {
    // 本地存储不可用时退回 data URL，至少当前会话可用
    return { id, name: file.name, url: await readDataUrl(file) }
  }
}

export async function pickGalleryImages(limit = 0): Promise<MediaRef[]> {
  let picked: MediaResults
  try {
    picked = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: true,
      limit,
      quality: 90,
      includeMetadata: true,
    })
  } catch (error) {
    if (/cancel/i.test(String((error as Error)?.message || error))) return []
    throw error
  }

  const media: MediaRef[] = []
  for (const [index, item] of picked.results.entries()) {
    try {
      const format = item.metadata?.format
      const blob = await galleryBlob(item, format)
      if (!blob) continue
      const ext = format === 'jpeg' ? 'jpg' : format || mimeExt(blob.type) || 'jpg'
      const file = new File([blob], `图库-${Date.now()}-${index + 1}.${ext}`, {
        type: blob.type || `image/${ext}`,
      })
      media.push(await readMedia(file))
    } catch {
      // 跳过无法读取的图片
    }
  }
  return media
}

async function galleryBlob(item: MediaResult, format?: string): Promise<Blob | null> {
  const source = item.webPath || (item.uri ? Capacitor.convertFileSrc(item.uri) : '')
  if (source) {
    try {
      const response = await fetch(source)
      if (response.ok) return await response.blob()
    } catch {
      // 继续尝试文件路径
    }
  }

  if (item.uri?.startsWith('file://')) {
    try {
      const result = await Filesystem.readFile({ path: item.uri })
      if (typeof result.data !== 'string') return null
      const binary = atob(result.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: format ? `image/${format}` : undefined })
    } catch {
      return null
    }
  }

  return null
}
