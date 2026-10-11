export interface CheckUpdateResult {
  ok: boolean
  current?: string
  latest?: string
  url?: string | null
  hasUpdate?: boolean
  note?: string
  error?: string
}

export interface JuemanBridge {
  port: number
  isElectron: boolean
  platform: string
  openPath: (p: string) => Promise<string>
  revealPath: (p: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  info: () => Promise<{
    port: number
    isDev: boolean
    userData: string
    dataHome: string
    version: string
    platform: string
  }>
  checkUpdate: () => Promise<CheckUpdateResult>
}

export interface LicenseAPI {
  getMachineId: () => Promise<{ code: string; display: string }>
  activate: (code: string) => Promise<{ ok: boolean; error?: string }>
  resetLicense: () => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    jueman?: JuemanBridge
    licenseAPI?: LicenseAPI
  }
}

export {}
