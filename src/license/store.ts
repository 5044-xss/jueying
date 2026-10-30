import { create } from 'zustand'
import type { LicenseState } from './types'

const initial: LicenseState = {
  phase: 'loading',
  status: null,
  allowed: false,
  machineCode: null,
  machineDisplay: null,
  message: '正在校验授权…',
  offline: false,
  warning: null,
  error: null,
  nbf: null,
  exp: null,
  licenseId: null,
  sn: null,
  trialTotalDays: null,
  trialLeftDays: null,
  trialTotalHours: null,
  trialLeftHours: null,
  serverTime: null,
  graceUntil: null,
  checkedAt: null,
}

function bypassState(): LicenseState {
  return {
    ...initial,
    phase: 'ready',
    status: 'active',
    allowed: true,
    message: '当前环境未启用桌面授权校验',
  }
}

function runningInElectron(): boolean {
  return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
}

function failureState(message: string, error: unknown): LicenseState {
  return {
    ...initial,
    phase: 'error',
    status: 'error',
    message,
    error: String((error as Error)?.message || error),
  }
}

interface LicenseStore {
  state: LicenseState
  checking: boolean
  activating: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  activate: (code: string) => Promise<{ ok: boolean; error?: string }>
  reset: () => Promise<void>
}

let started = false
let starting: Promise<void> | null = null

export const useLicense = create<LicenseStore>()((set, get) => ({
  state: initial,
  checking: false,
  activating: false,

  init: () => {
    if (started) return starting ?? Promise.resolve()
    started = true

    const bridge = window.desktop?.license
    if (!bridge) {
      if (window.desktop?.isDesktop || runningInElectron()) {
        set({ state: failureState('授权模块未加载', new Error('license bridge missing')) })
      } else {
        set({ state: bypassState() })
      }
      return Promise.resolve()
    }

    bridge.onUpdate((state) => set({ state }))

    starting = (async () => {
      try {
        const state = await bridge.getState()
        set({ state })
      } catch (error) {
        set({ state: failureState('授权校验失败', error) })
      }
    })()

    return starting
  },

  refresh: async () => {
    const bridge = window.desktop?.license
    if (!bridge || get().checking) return

    set({ checking: true })
    try {
      const state = await bridge.checkin()
      set({ state })
    } catch (error) {
      set({
        state: {
          ...get().state,
          warning: String((error as Error)?.message || error),
        },
      })
    } finally {
      set({ checking: false })
    }
  },

  activate: async (code) => {
    const bridge = window.desktop?.license
    if (!bridge) return { ok: false, error: '当前环境不支持授权激活' }
    if (get().activating) return { ok: false, error: '正在激活，请稍候' }

    set({ activating: true })
    try {
      const result = await bridge.activate(code)
      set({ state: result.state })
      return { ok: result.ok, error: result.error }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error) }
    } finally {
      set({ activating: false })
    }
  },

  reset: async () => {
    const bridge = window.desktop?.license
    if (!bridge) return
    set({ checking: true })
    try {
      const state = await bridge.reset()
      set({ state })
    } catch (error) {
      set({
        state: {
          ...get().state,
          warning: String((error as Error)?.message || error),
        },
      })
    } finally {
      set({ checking: false })
    }
  },
}))
