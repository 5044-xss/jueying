import { create } from 'zustand'
import type { LicenseBridge, LicenseState } from './types'
import { createDeviceLicenseBridge } from './device'

const initial: LicenseState = {
  phase: 'loading',
  status: null,
  allowed: false,
  machineCode: null,
  machineDisplay: null,
  message: '正在校验授权',
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

function failureState(message: string, error: unknown): LicenseState {
  return {
    ...initial,
    phase: 'error',
    status: 'error',
    message,
    error: String((error as Error)?.message || error),
  }
}

let licenseBridge: LicenseBridge | null = null

function getBridge(): LicenseBridge {
  if (!licenseBridge) {
    licenseBridge = window.desktop?.license ?? createDeviceLicenseBridge()
  }
  return licenseBridge
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

    const bridge = getBridge()
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
    if (get().checking) return
    const bridge = getBridge()

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
    if (get().activating) return { ok: false, error: '正在激活，请稍候' }
    const bridge = getBridge()

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
    const bridge = getBridge()
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
