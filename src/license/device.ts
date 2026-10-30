import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { verifyAsync } from '@noble/ed25519'
import type {
  LicenseActivateResult,
  LicenseBridge,
  LicenseMachine,
  LicenseState,
  LicenseStatus,
} from './types'

const PRODUCT = 'jueying'
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEA9FYp+8pO14P39bg/T9RqHI2wxwYi42+FEj9gru51Xro='
const STORAGE_KEY = 'jueying.license.key.v1'
const INSTALL_KEY = 'jueying.install.id.v1'

const STATUS_MESSAGES: Record<LicenseStatus, string> = {
  active: '授权有效',
  trial: '试用中',
  pending: '授权尚未生效',
  expired: '授权或试用已过期',
  revoked: '授权已被吊销',
  none: '未找到授权，请输入激活码',
  invalid: '本地授权无效',
  error: '授权校验失败',
}

interface LicensePayload {
  v?: number
  mid?: unknown
  sn?: unknown
  prod?: unknown
  nbf?: unknown
  exp?: unknown
}

function initialState(): LicenseState {
  return {
    phase: 'loading',
    status: null,
    allowed: false,
    machineCode: null,
    machineDisplay: null,
    message: '正在校验授权',
    offline: true,
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
    graceUntil: 0,
    checkedAt: null,
  }
}

function normalizeMid(value: string): string {
  return String(value || '').replace(/[-\s]/g, '').toUpperCase()
}

function formatCode(code: string): string {
  return String(code).replace(/(.{4})(?=.)/g, '$1-')
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

let cachedPublicKey: Uint8Array | null = null

function publicKey(): Uint8Array {
  if (!cachedPublicKey) {
    const der = decodeBase64Url(PUBLIC_KEY_B64)
    if (der.length < 32) throw new Error('内置公钥无效')
    cachedPublicKey = der.slice(der.length - 32)
  }
  return cachedPublicKey
}

async function verifyLicenseText(
  text: string,
  mid: string,
): Promise<{ payload?: LicensePayload; error?: string }> {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { error: '激活码为空' }
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return { error: '激活码格式不正确' }

  const payloadPart = trimmed.slice(0, dot)
  const signaturePart = trimmed.slice(dot + 1)
  let valid = false
  try {
    valid = await verifyAsync(
      decodeBase64Url(signaturePart),
      new TextEncoder().encode(payloadPart),
      publicKey(),
    )
  } catch {
    valid = false
  }
  if (!valid) return { error: '激活码签名无效' }

  let payload: LicensePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as LicensePayload
  } catch {
    return { error: '激活码内容损坏' }
  }
  if (!payload || typeof payload.mid !== 'string' || typeof payload.sn !== 'string') {
    return { error: '激活码内容不完整' }
  }
  if (payload.prod !== PRODUCT) return { error: '该激活码不属于当前产品' }
  if (normalizeMid(payload.mid) !== normalizeMid(mid)) {
    return { error: '激活码与本机不匹配' }
  }
  return { payload }
}

function statusOf(nbf: number | null, exp: number | null, now: number): LicenseStatus {
  if (nbf !== null && now < nbf) return 'pending'
  if (exp !== null && exp <= now) return 'expired'
  return 'active'
}

function stateFromPayload(payload: LicensePayload, mid: string, now: number): LicenseState {
  const nbf = numberOrNull(payload.nbf)
  const exp = numberOrNull(payload.exp)
  const status = statusOf(nbf, exp, now)
  return {
    phase: 'ready',
    status,
    allowed: status === 'active' || status === 'trial',
    machineCode: normalizeMid(mid),
    machineDisplay: formatCode(normalizeMid(mid)),
    message: STATUS_MESSAGES[status],
    offline: true,
    warning: null,
    error: null,
    nbf,
    exp,
    licenseId: null,
    sn: typeof payload.sn === 'string' ? payload.sn : null,
    trialTotalDays: null,
    trialLeftDays: null,
    trialTotalHours: null,
    trialLeftHours: null,
    serverTime: now,
    graceUntil: 0,
    checkedAt: now,
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
  }
}

function randomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
}

async function hashMachine(raw: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
    .toUpperCase()
}

let machine: LicenseMachine | null = null
let machinePromise: Promise<LicenseMachine> | null = null

async function ensureMachine(): Promise<LicenseMachine> {
  if (machine) return machine
  if (!machinePromise) {
    machinePromise = (async () => {
      let identifier = ''
      try {
        const result = await Device.getId()
        identifier = result.identifier || ''
      } catch {
        identifier = ''
      }
      if (!identifier) {
        identifier = readStorage(INSTALL_KEY) || ''
        if (!identifier) {
          identifier = randomId()
          writeStorage(INSTALL_KEY, identifier)
        }
      }
      const code = await hashMachine(`${PRODUCT}|${Capacitor.getPlatform()}|${identifier}`)
      machine = { code, display: formatCode(code) }
      return machine
    })().catch((error) => {
      machinePromise = null
      throw error
    })
  }
  return machinePromise
}

let state = initialState()
let started: Promise<void> | null = null
const listeners = new Set<(next: LicenseState) => void>()

function setState(patch: Partial<LicenseState>): LicenseState {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
    }
  }
  return state
}

function failure(message: string, error: unknown): LicenseState {
  return setState({
    ...initialState(),
    phase: 'ready',
    status: 'error',
    machineCode: machine?.code ?? null,
    machineDisplay: machine?.display ?? null,
    message,
    error: String((error as Error)?.message || error),
    checkedAt: Date.now(),
  })
}

async function load(mid: string): Promise<LicenseState> {
  const now = Date.now()
  const saved = readStorage(STORAGE_KEY)
  if (!saved) {
    return setState({
      ...initialState(),
      phase: 'ready',
      status: 'none',
      machineCode: normalizeMid(mid),
      machineDisplay: formatCode(normalizeMid(mid)),
      message: STATUS_MESSAGES.none,
      serverTime: now,
      checkedAt: now,
    })
  }

  const result = await verifyLicenseText(saved, mid)
  if (!result.payload) {
    return setState({
      ...initialState(),
      phase: 'ready',
      status: 'invalid',
      machineCode: normalizeMid(mid),
      machineDisplay: formatCode(normalizeMid(mid)),
      message: STATUS_MESSAGES.invalid,
      error: result.error ?? null,
      serverTime: now,
      checkedAt: now,
    })
  }
  return setState(stateFromPayload(result.payload, mid, now))
}

async function start(): Promise<void> {
  if (!started) {
    started = (async () => {
      try {
        setState({ phase: 'loading', message: '正在获取设备标识' })
        const current = await ensureMachine()
        setState({
          machineCode: current.code,
          machineDisplay: current.display,
          message: '正在校验授权',
        })
        await load(current.code)
      } catch (error) {
        failure('授权校验失败', error)
      }
    })()
  }
  return started
}

async function checkin(): Promise<LicenseState> {
  await start()
  if (!machine) return failure('无法获取设备标识', new Error('machine missing'))
  try {
    return await load(machine.code)
  } catch (error) {
    return failure('授权校验失败', error)
  }
}

async function activate(code: string): Promise<LicenseActivateResult> {
  await start()
  if (!machine) return { ok: false, error: '无法获取设备标识', state }
  const value = String(code || '').trim()
  if (!value) return { ok: false, error: '请先填入激活码', state }

  let result: { payload?: LicensePayload; error?: string }
  try {
    result = await verifyLicenseText(value, machine.code)
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error), state }
  }
  if (!result.payload) {
    return { ok: false, error: result.error || '激活码无效', state }
  }

  const next = stateFromPayload(result.payload, machine.code, Date.now())
  if (next.status === 'expired') {
    setState(next)
    return { ok: false, error: '激活码已过期', state }
  }

  writeStorage(STORAGE_KEY, value)
  setState(next)
  return { ok: true, state }
}

async function reset(): Promise<LicenseState> {
  await start()
  removeStorage(STORAGE_KEY)
  const now = Date.now()
  return setState({
    ...initialState(),
    phase: 'ready',
    status: 'none',
    machineCode: machine?.code ?? null,
    machineDisplay: machine?.display ?? null,
    message: '已清除本地授权',
    serverTime: now,
    checkedAt: now,
  })
}

export function createDeviceLicenseBridge(): LicenseBridge {
  return {
    getMachineId: async () => {
      const current = await ensureMachine()
      return { code: current.code, display: current.display }
    },
    getState: async () => {
      await start()
      return state
    },
    checkin,
    activate,
    reset,
    onUpdate: (callback) => {
      listeners.add(callback)
    },
  }
}
