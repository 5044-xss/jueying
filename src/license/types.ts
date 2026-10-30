export type LicenseStatus =
  | 'active'
  | 'trial'
  | 'pending'
  | 'expired'
  | 'revoked'
  | 'none'
  | 'invalid'
  | 'error'

export interface LicenseState {
  phase: 'loading' | 'ready' | 'error'
  status: LicenseStatus | null
  allowed: boolean
  machineCode: string | null
  machineDisplay: string | null
  message: string
  offline: boolean
  warning: string | null
  error: string | null
  nbf: number | null
  exp: number | null
  licenseId: string | null
  sn: string | null
  trialTotalDays: number | null
  trialLeftDays: number | null
  trialTotalHours: number | null
  trialLeftHours: number | null
  serverTime: number | null
  graceUntil: number | null
  checkedAt: number | null
}

export interface LicenseMachine {
  code: string
  display: string
}

export interface LicenseActivateResult {
  ok: boolean
  error?: string
  state: LicenseState
}

export interface LicenseBridge {
  getMachineId: () => Promise<LicenseMachine>
  getState: () => Promise<LicenseState>
  checkin: () => Promise<LicenseState>
  activate: (code: string) => Promise<LicenseActivateResult>
  reset: () => Promise<LicenseState>
  onUpdate: (callback: (state: LicenseState) => void) => void
}
