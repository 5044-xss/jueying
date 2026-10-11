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
    const direct = localStorage.getItem(key(id))
    if (direct) return JSON.parse(direct) as JobMeta
    // 回填的历史条目 id 是原任务 id 的前 8 位；按前缀找回对应草稿。
    const prefix = key(id)
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) {
        const s = localStorage.getItem(k)
        if (s) return JSON.parse(s) as JobMeta
      }
    }
    return null
  } catch {
    return null
  }
}
