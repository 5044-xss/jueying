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
