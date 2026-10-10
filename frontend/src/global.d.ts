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
    version: string
    platform: string
  }>
}

declare global {
  interface Window {
    jueman?: JuemanBridge
  }
}

export {}
