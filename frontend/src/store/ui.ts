import { create } from 'zustand'
import type { JobForm } from '../api/types'

export type View = 'generator' | 'settings' | 'history'

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
