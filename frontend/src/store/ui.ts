import { create } from 'zustand'
import type { CreateJobBody, JobForm } from '../api/types'
import type { JobMeta } from '../lib/jobMeta'

export type View = 'generator' | 'settings' | 'history'
export type GenMode = 'reference' | 'frames'

export interface QueuedJob {
  key: string
  body: CreateJobBody
  meta: JobMeta
}

const DEFAULT_FORM: JobForm = {
  title: 'clip',
  duration: 8,
  aspect: '16:9',
  resolution: '0.5',
  seed: 0,
  samplerMode: '',
  modelVariant: 'auto',
}

interface DraftState {
  view: View
  setView: (v: View) => void

  // 素材顺序 = 参考图顺序 = <Picture N>
  imageOrder: string[]
  audioIds: string[]
  firstFrame: string | null
  lastFrame: string | null
  prompt: string
  currentJobId: string | null
  pendingForm: Partial<JobForm> | null

  // 生成参数：放在 store 里，切换页面/回到生成台不重置
  form: JobForm
  formReady: boolean
  mode: GenMode
  setForm: (patch: Partial<JobForm>) => void
  setFormReady: (v: boolean) => void
  setMode: (m: GenMode) => void

  // 生成中提交的任务先挂起，等当前任务彻底结束后依次发起
  queue: QueuedJob[]
  enqueue: (q: QueuedJob) => void
  removeQueued: (key: string) => void
  shiftQueue: () => QueuedJob | undefined

  setPrompt: (p: string) => void
  setCurrentJobId: (id: string | null) => void
  setPendingForm: (f: Partial<JobForm> | null) => void

  addImage: (id: string) => void
  removeImage: (id: string) => void
  moveImage: (from: number, to: number) => void
  clearImages: () => void

  addAudio: (id: string) => void
  removeAudio: (id: string) => void

  setFirstFrame: (id: string | null) => void
  setLastFrame: (id: string | null) => void

  loadDraft: (d: {
    prompt: string
    imageOrder: string[]
    audioIds: string[]
    firstFrame: string | null
    lastFrame: string | null
  }) => void

  resetDraft: () => void
}

export const useUI = create<DraftState>((set, get) => ({
  view: 'generator',
  setView: (v) => set({ view: v }),

  imageOrder: [],
  audioIds: [],
  firstFrame: null,
  lastFrame: null,
  prompt: '',
  currentJobId: null,
  pendingForm: null,

  form: { ...DEFAULT_FORM },
  formReady: false,
  mode: 'reference',
  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  setFormReady: (v) => set({ formReady: v }),
  setMode: (m) => set({ mode: m }),

  queue: [],
  enqueue: (q) => set((s) => ({ queue: [...s.queue, q] })),
  removeQueued: (key) =>
    set((s) => ({ queue: s.queue.filter((x) => x.key !== key) })),
  shiftQueue: () => {
    const q = get().queue
    if (q.length === 0) return undefined
    set({ queue: q.slice(1) })
    return q[0]
  },

  setPrompt: (p) => set({ prompt: p }),
  setCurrentJobId: (id) => set({ currentJobId: id }),
  setPendingForm: (f) => set({ pendingForm: f }),

  addImage: (id) => {
    const { imageOrder } = get()
    if (imageOrder.includes(id)) return
    set({ imageOrder: [...imageOrder, id] })
  },
  removeImage: (id) =>
    set((s) => ({
      imageOrder: s.imageOrder.filter((x) => x !== id),
      firstFrame: s.firstFrame === id ? null : s.firstFrame,
      lastFrame: s.lastFrame === id ? null : s.lastFrame,
    })),
  moveImage: (from, to) =>
    set((s) => {
      const arr = [...s.imageOrder]
      if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return s
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { imageOrder: arr }
    }),
  clearImages: () => set({ imageOrder: [], firstFrame: null, lastFrame: null }),

  addAudio: (id) => {
    const { audioIds } = get()
    if (audioIds.includes(id)) return
    set({ audioIds: [...audioIds, id] })
  },
  removeAudio: (id) => set((s) => ({ audioIds: s.audioIds.filter((x) => x !== id) })),

  setFirstFrame: (id) => set({ firstFrame: id }),
  setLastFrame: (id) => set({ lastFrame: id }),

  loadDraft: (d) =>
    set({
      prompt: d.prompt,
      imageOrder: d.imageOrder,
      audioIds: d.audioIds,
      firstFrame: d.firstFrame,
      lastFrame: d.lastFrame,
    }),

  resetDraft: () =>
    set({ prompt: '', currentJobId: null }),
}))
