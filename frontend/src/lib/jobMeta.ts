import type { JobForm } from '../api/types'

export interface JobMeta {
  prompt: string
  images: string[]
  audios: string[]
  firstFrame: string | null
  lastFrame: string | null
  form: JobForm
}

const key = (id: string) => `jueman.jobmeta.${id}`

export function saveJobMeta(id: string, meta: JobMeta) {
  try {
    localStorage.setItem(key(id), JSON.stringify(meta))
  } catch {
    /* 忽略配额/隐私模式错误 */
  }
}

export function readJobMeta(id: string): JobMeta | null {
  try {
    const s = localStorage.getItem(key(id))
    return s ? (JSON.parse(s) as JobMeta) : null
  } catch {
    return null
  }
}
