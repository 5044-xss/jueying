import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'error' | 'warn'

export interface Toast {
  id: number
  type: ToastType
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (type: ToastType, text: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (type, text) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts, { id, type, text }] }))
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, type === 'error' ? 6000 : 3600)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  info: (t: string) => useToasts.getState().push('info', t),
  success: (t: string) => useToasts.getState().push('success', t),
  error: (t: string) => useToasts.getState().push('error', t),
  warn: (t: string) => useToasts.getState().push('warn', t),
}
