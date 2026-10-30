import { Capacitor, CapacitorHttp } from '@capacitor/core'
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
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAV3Y7o43+5FnPWh3YQ4ayKl40LQSer1t3om4NzLoDKYY='
const BASE_URL = (import.meta.env.VITE_LICENSE_API || 'http://101.43.46.217').replace(/\/+$/, '')
const STORAGE_KEY = 'jueying.license.key.v1'
const CACHE_KEY = 'jueying.license.cache.v1'
const INSTALL_KEY = 'jueying.install.id.v1'

const POLICY = {
  timeoutMs: 8000,
  normalIntervalMs: 6 * 60 * 60 * 1000,
  nearExpiryWindowMs: 24 * 60 * 60 * 1000,
  nearExpiryIntervalMs: 60 * 60 * 1000,
  wakeMinGapMs: 30 * 60 * 1000,
}

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

const STATUS_VALUES: LicenseStatus[] = [
  'active',
  'trial',
  'pending',
  'expired',
  'revoked',
  'none',
  'invalid',
  'error',
]

interface LicensePayload {
  v?: number
  mid?: unknown
  sn?: unknown
  prod?: unknown
  nbf?: unknown
  exp?: unknown
}

interface ServerData {
  product?: unknown
  mid?: unknown
  status?: unknown
  nbf?: unknown
  exp?: unknown
  licenseId?: unknown
  sn?: unknown
  trialTotalDays?: unknown
  trialLeftDays?: unknown
  trialTotalHours?: unknown
  trialLeftHours?: unknown
  serverTime?: unknown
  graceUntil?: unknown
  message?: unknown
}

interface CheckinResult {
  data: ServerData
  payload: string
  sig: string
}

interface LicenseError extends Error {
  code?: string
  status?: number
}

function initialState(): LicenseState {
  return {
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

function isStatus(value: unknown): value is LicenseStatus {
  return typeof value === 'string' && STATUS_VALUES.includes(value as LicenseStatus)
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

async function verifySignedPayload(
  payloadPart: string,
  signaturePart: string,
): Promise<Record<string, unknown> | null> {
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
  if (!valid) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
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
  const data = await verifySignedPayload(payloadPart, signaturePart)
  if (!data) return { error: '激活码签名无效' }

  const payload = data as LicensePayload
  if (typeof payload.mid !== 'string' || typeof payload.sn !== 'string') {
    return { error: '激活码内容不完整' }
  }
  if (payload.prod !== PRODUCT) return { error: '该激活码不属于当前产品' }
  if (normalizeMid(payload.mid) !== normalizeMid(mid)) {
    return { error: '激活码与本机不匹配' }
  }
  return { payload }
}

async function verifyEnvelope(payload: string, sig: string): Promise<ServerData | null> {
  const data = await verifySignedPayload(payload, sig)
  if (!data) return null
  return data as ServerData
}

function statusOf(nbf: number | null, exp: number | null, now: number): LicenseStatus {
  if (nbf !== null && now < nbf) return 'pending'
  if (exp !== null && exp <= now) return 'expired'
  return 'active'
}

function localPayloadData(payload: LicensePayload, now: number): ServerData {
  const nbf = numberOrNull(payload.nbf)
  const exp = numberOrNull(payload.exp)
  const status = statusOf(nbf, exp, now)
  return {
    product: PRODUCT,
    mid: normalizeMid(String(payload.mid || '')),
    status,
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
    message: STATUS_MESSAGES[status],
  }
}

function stateFromData(
  data: ServerData,
  mid: string,
  extra: { offline: boolean; warning?: string | null },
): LicenseState {
  const now = Date.now()
  const status = isStatus(data.status) ? data.status : 'none'
  return {
    phase: 'ready',
    status,
    allowed: status === 'active' || status === 'trial',
    machineCode: normalizeMid(mid),
    machineDisplay: formatCode(normalizeMid(mid)),
    message:
      typeof data.message === 'string' && data.message ? data.message : STATUS_MESSAGES[status],
    offline: extra.offline,
    warning: extra.warning ? String(extra.warning) : null,
    error: null,
    nbf: numberOrNull(data.nbf),
    exp: numberOrNull(data.exp),
    licenseId: typeof data.licenseId === 'string' ? data.licenseId : null,
    sn: typeof data.sn === 'string' ? data.sn : null,
    trialTotalDays: numberOrNull(data.trialTotalDays),
    trialLeftDays: numberOrNull(data.trialLeftDays),
    trialTotalHours: numberOrNull(data.trialTotalHours),
    trialLeftHours: numberOrNull(data.trialLeftHours),
    serverTime: numberOrNull(data.serverTime) ?? now,
    graceUntil: numberOrNull(data.graceUntil) ?? 0,
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

function getInstallId(): string {
  let identifier = readStorage(INSTALL_KEY)
  if (!identifier) {
    identifier = randomId()
    writeStorage(INSTALL_KEY, identifier)
  }
  return identifier
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

async function postJson(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const headers = { 'Content-Type': 'application/json' }
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: POLICY.timeoutMs,
      readTimeout: POLICY.timeoutMs,
    })
    let data = response.data as unknown
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
      }
    }
    return { status: response.status, data }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POLICY.timeoutMs),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function requestCheckin({
  mid,
  license,
}: {
  mid: string
  license: string | null
}): Promise<CheckinResult> {
  let response: { status: number; data: unknown }
  try {
    response = await postJson(`${BASE_URL}/api/license/checkin`, {
      product: PRODUCT,
      mid,
      license: license || null,
      installId: getInstallId(),
      appVersion: __APP_VERSION__,
    })
  } catch (error) {
    const wrapped = new Error(
      `无法连接授权服务器：${(error as Error)?.message || error}`,
    ) as LicenseError
    wrapped.code = 'network'
    throw wrapped
  }

  const body = response.data as
    | { ok?: boolean; error?: string; payload?: string; sig?: string }
    | null
  if (!body || !body.ok) {
    const message = (body && body.error) || `校验失败（HTTP ${response.status}）`
    const error = new Error(message) as LicenseError
    error.code = response.status === 400 ? 'bad_request' : 'http'
    error.status = response.status
    throw error
  }
  if (!body.payload || !body.sig) throw new Error('响应格式无效')

  const data = await verifyEnvelope(body.payload, body.sig)
  if (!data) throw new Error('响应签名无效')
  if (data.product !== PRODUCT) throw new Error('响应产品不匹配')
  if (normalizeMid(String(data.mid || '')) !== normalizeMid(mid)) {
    throw new Error('响应机器码不匹配')
  }
  return { data, payload: body.payload, sig: body.sig }
}

function readCache(): { payload: string; sig: string; savedAt: number } | null {
  const raw = readStorage(CACHE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      payload?: unknown
      sig?: unknown
      savedAt?: unknown
    }
    if (
      typeof parsed.payload !== 'string' ||
      typeof parsed.sig !== 'string' ||
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt)
    ) {
      return null
    }
    return { payload: parsed.payload, sig: parsed.sig, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

function writeCache(payload: string, sig: string): void {
  writeStorage(CACHE_KEY, JSON.stringify({ payload, sig, savedAt: Date.now() }))
}

async function reusableCache(mid: string): Promise<ServerData | null> {
  const cache = readCache()
  if (!cache) return null
  const data = await verifyEnvelope(cache.payload, cache.sig)
  if (!data) return null
  if (data.product !== PRODUCT) return null
  if (normalizeMid(String(data.mid || '')) !== normalizeMid(mid)) return null
  const graceUntil = numberOrNull(data.graceUntil)
  if (!graceUntil || graceUntil <= 0) return null
  const serverTime = numberOrNull(data.serverTime)
  const offset = serverTime === null ? 0 : serverTime - cache.savedAt
  return Date.now() + offset <= graceUntil ? data : null
}

async function checkinWithFallback(
  mid: string,
  license: string | null,
): Promise<{ data: ServerData; offline: boolean; warning: string | null }> {
  try {
    const result = await requestCheckin({ mid, license })
    writeCache(result.payload, result.sig)
    return { data: result.data, offline: false, warning: null }
  } catch (error) {
    const cached = await reusableCache(mid)
    if (cached) {
      return {
        data: cached,
        offline: true,
        warning: (error as Error)?.message || '网络不可用，已使用本地缓存',
      }
    }

    if (license) {
      const local = await verifyLicenseText(license, mid)
      if (local.payload) {
        return {
          data: localPayloadData(local.payload, Date.now()),
          offline: true,
          warning: (error as Error)?.message || '网络不可用，已使用离线授权',
        }
      }
      if (local.error && local.error !== '激活码为空') {
        const wrapped = new Error(
          `${local.error}（且无法连接授权服务器）`,
        ) as LicenseError
        wrapped.code = (error as LicenseError)?.code || 'invalid'
        throw wrapped
      }
    }

    throw error
  }
}

let state = initialState()
let started: Promise<void> | null = null
let inflight: Promise<LicenseState> | null = null
let timer: number | null = null
let lastOnlineAt = 0
let wakeAttached = false
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
    offline: true,
    error: String((error as Error)?.message || error),
    checkedAt: Date.now(),
  })
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer)
  const nearExpiry =
    typeof state.exp === 'number' && state.exp - Date.now() < POLICY.nearExpiryWindowMs
  timer = window.setTimeout(
    () => {
      timer = null
      void checkin()
    },
    nearExpiry ? POLICY.nearExpiryIntervalMs : POLICY.normalIntervalMs,
  )
}

function attachWake(): void {
  if (wakeAttached) return
  wakeAttached = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    if (Date.now() - lastOnlineAt < POLICY.wakeMinGapMs) return
    void checkin()
  })
}

async function refreshNow(): Promise<LicenseState> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const current = await ensureMachine()
      const license = readStorage(STORAGE_KEY)
      const result = await checkinWithFallback(current.code, license)
      if (!result.offline) lastOnlineAt = Date.now()
      let next = stateFromData(result.data, current.code, result)
      if (next.status === 'revoked') {
        removeStorage(STORAGE_KEY)
        removeStorage(CACHE_KEY)
        next = {
          ...next,
          warning: next.warning || '授权已被吊销，本地授权状态已清除',
        }
      }
      setState(next)
      schedule()
      return state
    } catch (error) {
      failure('无法连接授权服务器', error)
      schedule()
      return state
    } finally {
      inflight = null
    }
  })()
  return inflight
}

async function boot(): Promise<void> {
  try {
    setState({ phase: 'loading', message: '正在获取设备标识' })
    const current = await ensureMachine()
    setState({
      machineCode: current.code,
      machineDisplay: current.display,
      message: '正在校验授权',
    })
    attachWake()
    await refreshNow()
  } catch (error) {
    failure('授权校验失败', error)
  }
}

async function start(): Promise<void> {
  if (!started) started = boot()
  await started
}

async function checkin(): Promise<LicenseState> {
  await start()
  return refreshNow()
}

async function activate(code: string): Promise<LicenseActivateResult> {
  await start()
  if (!machine) return { ok: false, error: '无法获取设备标识', state }
  const value = String(code || '').trim()
  if (!value) return { ok: false, error: '请先填入激活码', state }

  let local: { payload?: LicensePayload; error?: string }
  try {
    local = await verifyLicenseText(value, machine.code)
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error), state }
  }
  if (!local.payload) {
    return { ok: false, error: local.error || '激活码无效', state }
  }

  const localData = localPayloadData(local.payload, Date.now())
  if (localData.status === 'expired') {
    setState(stateFromData(localData, machine.code, { offline: true }))
    return { ok: false, error: '激活码已过期', state }
  }

  try {
    const online = await requestCheckin({ mid: machine.code, license: value })
    const next = stateFromData(online.data, machine.code, { offline: false })
    if (next.status !== 'active' && next.status !== 'pending') {
      if (next.status === 'revoked') {
        removeStorage(STORAGE_KEY)
        removeStorage(CACHE_KEY)
      }
      setState(next)
      return {
        ok: false,
        error:
          next.status === 'trial'
            ? '激活码未在授权中心登记'
            : next.message || '激活失败',
        state,
      }
    }

    writeStorage(STORAGE_KEY, value)
    writeCache(online.payload, online.sig)
    lastOnlineAt = Date.now()
    setState(next)
    schedule()
    return { ok: true, state }
  } catch (error) {
    const current = error as LicenseError
    if (current.code === 'bad_request') {
      return { ok: false, error: current.message, state }
    }

    writeStorage(STORAGE_KEY, value)
    const next = stateFromData(localData, machine.code, {
      offline: true,
      warning: '暂时无法连接授权服务器，已按离线激活码放行',
    })
    setState(next)
    schedule()
    return { ok: true, state }
  }
}

async function reset(): Promise<LicenseState> {
  await start()
  removeStorage(STORAGE_KEY)
  removeStorage(CACHE_KEY)
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
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
