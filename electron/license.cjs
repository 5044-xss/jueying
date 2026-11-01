const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { getMachineCode, formatCode } = require('./machine-id.cjs')
const { publicKey: PUBLIC_KEY_B64 } = require('./license-public.cjs')

const PRODUCTION_BASE_URL = 'http://101.43.46.217'
const DEV_BASE_URL = 'http://127.0.0.1:7000'
const PRODUCT = 'jueying'
const LICENSE_FILE = 'license.key'
const STATE_FILE = 'license-state.json'
const INSTALL_ID_FILE = 'install-id'

const POLICY = {
  timeoutMs: 8000,
  normalIntervalMs: 6 * 60 * 60 * 1000,
  nearExpiryWindowMs: 24 * 60 * 60 * 1000,
  nearExpiryIntervalMs: 60 * 60 * 1000,
  wakeMinGapMs: 30 * 60 * 1000,
}

const STATUS_MESSAGES = {
  active: '授权有效',
  trial: '试用中',
  pending: '授权尚未生效',
  expired: '授权或试用已过期',
  revoked: '授权已被吊销',
  none: '未找到授权，请激活或申请试用',
  invalid: '激活码无效',
  error: '无法连接授权服务器',
}

let cachedPublicKey = null

function decodeBase64Url(value) {
  return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function normalizeMid(value) {
  return String(value || '').replace(/[-\s]/g, '').toUpperCase()
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey
  cachedPublicKey = crypto.createPublicKey({
    key: Buffer.from(PUBLIC_KEY_B64, 'base64'),
    type: 'spki',
    format: 'der',
  })
  return cachedPublicKey
}

function verifyEnvelope(payload, sig) {
  if (typeof payload !== 'string' || typeof sig !== 'string' || !payload || !sig) {
    throw new Error('响应格式无效')
  }
  let valid = false
  try {
    valid = crypto.verify(
      null,
      Buffer.from(payload, 'utf8'),
      getPublicKey(),
      decodeBase64Url(sig),
    )
  } catch {
    valid = false
  }
  if (!valid) throw new Error('响应签名无效')
  let data
  try {
    data = JSON.parse(decodeBase64Url(payload).toString('utf8'))
  } catch {
    throw new Error('响应内容损坏')
  }
  if (!data || typeof data !== 'object') throw new Error('响应内容损坏')
  return data
}

function decodeLicenseText(text, mid) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { error: '激活码为空' }
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return { error: '激活码格式不正确' }
  const payloadPart = trimmed.slice(0, dot)
  const sigPart = trimmed.slice(dot + 1)
  let valid = false
  try {
    valid = crypto.verify(
      null,
      Buffer.from(payloadPart, 'utf8'),
      getPublicKey(),
      decodeBase64Url(sigPart),
    )
  } catch {
    valid = false
  }
  if (!valid) return { error: '激活码签名无效' }

  let payload
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart).toString('utf8'))
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

function localStatus(payload, now = Date.now()) {
  if (typeof payload.nbf === 'number' && now < payload.nbf) return 'pending'
  if (typeof payload.exp === 'number' && payload.exp <= now) return 'expired'
  return 'active'
}

function localPayloadData(payload, now) {
  const status = localStatus(payload, now)
  return {
    v: 2,
    product: PRODUCT,
    mid: normalizeMid(payload.mid),
    status,
    nbf: numberOrNull(payload.nbf),
    exp: numberOrNull(payload.exp),
    licenseId: null,
    sn: typeof payload.sn === 'string' ? payload.sn : null,
    trialTotalDays: null,
    trialLeftDays: null,
    trialTotalHours: null,
    trialLeftHours: null,
    serverTime: now,
    graceUntil: 0,
    message: STATUS_MESSAGES[status] || STATUS_MESSAGES.none,
  }
}

function createLicenseService({
  userDataDir,
  appVersion,
  baseUrl,
  isPackaged = true,
  onUpdate: onUpdateHandler = null,
}) {
  const base = String(
    baseUrl ||
      process.env.JUEYING_LICENSE_API ||
      process.env.LICENSE_API ||
      (isPackaged ? PRODUCTION_BASE_URL : DEV_BASE_URL),
  ).replace(/\/+$/, '')

  const licensePath = path.join(userDataDir, LICENSE_FILE)
  const statePath = path.join(userDataDir, STATE_FILE)
  const installIdPath = path.join(userDataDir, INSTALL_ID_FILE)

  let machine = null
  let machinePromise = null
  let installPromise = null
  let inflight = null
  let firstRun = null
  let timer = null
  let stopped = false
  let lastSuccessMono = 0

  let state = {
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

  function setState(patch) {
    state = { ...state, ...patch }
    try {
      service.onUpdate?.(state)
    } catch {
    }
    return state
  }

  function setMachine(patch = {}) {
    return setState({
      machineCode: machine ? machine.code : null,
      machineDisplay: machine ? machine.display : null,
      ...patch,
    })
  }

  function errorState(message, error) {
    return setMachine({
      phase: 'ready',
      status: 'error',
      allowed: false,
      message,
      offline: true,
      warning: null,
      error: error ? String(error.message || error) : null,
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
      checkedAt: Date.now(),
    })
  }

  function stateFromData(data, fallbackMid, extra = {}) {
    const status = STATUS_MESSAGES[data.status] ? data.status : 'none'
    const mid = normalizeMid(data.mid || fallbackMid)
    return {
      phase: 'ready',
      status,
      allowed: status === 'active' || status === 'trial',
      machineCode: mid || null,
      machineDisplay: mid ? formatCode(mid) : null,
      message:
        typeof data.message === 'string' && data.message
          ? data.message
          : STATUS_MESSAGES[status] || STATUS_MESSAGES.none,
      offline: Boolean(extra.offline),
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
      serverTime: numberOrNull(data.serverTime) ?? Date.now(),
      graceUntil: numberOrNull(data.graceUntil) ?? 0,
      checkedAt: Date.now(),
    }
  }

  function ensureMachine() {
    if (machine) return Promise.resolve(machine)
    if (!machinePromise) {
      machinePromise = getMachineCode()
        .then((value) => {
          machine = value
          return value
        })
        .catch((error) => {
          machinePromise = null
          throw error
        })
    }
    return machinePromise
  }

  function getInstallId() {
    if (!installPromise) {
      installPromise = (async () => {
        try {
          const saved = fs.readFileSync(installIdPath, 'utf8').trim()
          if (/^[0-9a-f-]{36}$/i.test(saved)) return saved
        } catch {
        }
        const id = crypto.randomUUID()
        try {
          fs.mkdirSync(path.dirname(installIdPath), { recursive: true })
          fs.writeFileSync(installIdPath, id, 'utf8')
        } catch {
        }
        return id
      })()
    }
    return installPromise
  }

  function readLicenseText() {
    try {
      return fs.readFileSync(licensePath, 'utf8').trim() || null
    } catch {
      return null
    }
  }

  function saveLicenseText(text) {
    fs.mkdirSync(path.dirname(licensePath), { recursive: true })
    const tmp = licensePath + '.tmp'
    fs.writeFileSync(tmp, String(text).trim(), 'utf8')
    fs.renameSync(tmp, licensePath)
  }

  function clearLicenseText() {
    try {
      fs.rmSync(licensePath, { force: true })
    } catch {
    }
  }

  function readStateCache() {
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      if (!raw || typeof raw.payload !== 'string' || typeof raw.sig !== 'string') return null
      const data = verifyEnvelope(raw.payload, raw.sig)
      const savedAt = Number(raw.savedAt)
      if (!Number.isFinite(savedAt)) return null
      return { data, payload: raw.payload, sig: raw.sig, savedAt }
    } catch {
      return null
    }
  }

  function writeStateCache(payload, sig) {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      const tmp = statePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ payload, sig, savedAt: Date.now() }), 'utf8')
      fs.renameSync(tmp, statePath)
    } catch {
    }
  }

  function clearStateCache() {
    try {
      fs.rmSync(statePath, { force: true })
    } catch {
    }
  }

  function isCacheReusable(cache, mid, now) {
    if (!cache) return false
    if (normalizeMid(cache.data.mid) !== normalizeMid(mid)) return false
    if (cache.data.product !== PRODUCT) return false
    const graceUntil = numberOrNull(cache.data.graceUntil)
    if (!graceUntil || graceUntil <= 0) return false
    const serverTime = numberOrNull(cache.data.serverTime)
    const offset = serverTime === null ? 0 : serverTime - cache.savedAt
    const serverNow = now + offset
    return serverNow <= graceUntil
  }

  async function requestCheckin({ mid, license, installId, appVersion: version }) {
    let response
    try {
      response = await fetch(`${base}/api/license/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: PRODUCT,
          mid,
          license: license || null,
          installId: installId || null,
          appVersion: version || null,
        }),
        signal: AbortSignal.timeout(POLICY.timeoutMs),
      })
    } catch (error) {
      const wrapped = new Error(`无法连接授权服务器：${error.message || error}`)
      wrapped.code = 'network'
      throw wrapped
    }

    const body = await response.json().catch(() => null)
    if (!body || !body.ok) {
      const message = (body && body.error) || `校验失败（HTTP ${response.status}）`
      const error = new Error(message)
      error.code = response.status === 400 ? 'bad_request' : 'http'
      error.status = response.status
      throw error
    }
    if (!body.payload || !body.sig) throw new Error('响应格式无效')

    const data = verifyEnvelope(body.payload, body.sig)
    if (data.product !== PRODUCT) throw new Error('响应产品不匹配')
    if (normalizeMid(data.mid) !== normalizeMid(mid)) throw new Error('响应机器码不匹配')
    return { data, payload: body.payload, sig: body.sig }
  }

  async function checkinWithFallback({ mid, license, installId, version }) {
    try {
      const result = await requestCheckin({
        mid,
        license,
        installId,
        appVersion: version,
      })
      writeStateCache(result.payload, result.sig)
      return { data: result.data, offline: false, warning: null }
    } catch (error) {
      const cache = readStateCache()
      if (isCacheReusable(cache, mid, Date.now())) {
        return {
          data: cache.data,
          offline: true,
          warning: error.message || '网络不可用，已使用本地缓存',
        }
      }

      if (license) {
        const local = decodeLicenseText(license, mid)
        if (local.payload) {
          const now = Date.now()
          return {
            data: localPayloadData(local.payload, now),
            offline: true,
            warning: error.message || '网络不可用，已使用离线授权',
          }
        }
        if (local.error && local.error !== '激活码为空') {
          const wrapped = new Error(`${local.error}（且无法连接授权服务器）`)
          wrapped.code = error.code || 'invalid'
          throw wrapped
        }
      }

      throw error
    }
  }

  function nextDelay() {
    if (typeof state.exp !== 'number') return POLICY.normalIntervalMs
    const offset =
      typeof state.serverTime === 'number' && typeof state.checkedAt === 'number'
        ? state.serverTime - state.checkedAt
        : 0
    const serverNow = Date.now() + offset
    const nearExpiry = state.exp - serverNow < POLICY.nearExpiryWindowMs
    return nearExpiry ? POLICY.nearExpiryIntervalMs : POLICY.normalIntervalMs
  }

  function schedule() {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, nextDelay())
    if (timer.unref) timer.unref()
  }

  async function refresh({ manual = false } = {}) {
    if (stopped) return state
    if (inflight) return inflight

    inflight = (async () => {
      try {
        const m = await ensureMachine()
        const silent = state.phase === 'ready' && !manual
        setMachine({
          phase: silent ? 'ready' : 'loading',
          message: manual ? '正在检查授权…' : silent ? state.message : '正在校验授权…',
          error: silent ? state.error : null,
        })

        const result = await checkinWithFallback({
          mid: m.code,
          license: readLicenseText(),
          installId: await getInstallId(),
          version: appVersion,
        })

        lastSuccessMono = performance.now()
        let next = stateFromData(result.data, m.code, {
          offline: result.offline,
          warning: result.warning,
        })
        if (next.status === 'revoked') {
          clearLicenseText()
          clearStateCache()
          next = {
            ...next,
            warning: next.warning || '授权已被吊销，本地授权状态已清除',
          }
        }
        setState(next)
        schedule()
        return state
      } catch (error) {
        if (!machine) {
          errorState('无法获取本机机器码', error)
        } else {
          errorState('无法连接授权服务器', error)
        }
        schedule()
        return state
      } finally {
        inflight = null
      }
    })()

    return inflight
  }

  async function activate(code) {
    const value = String(code || '').trim()
    if (!value) return { ok: false, error: '请先填入激活码', state }

    let m
    try {
      m = await ensureMachine()
    } catch (error) {
      return { ok: false, error: `无法获取本机机器码：${error.message || error}`, state }
    }

    setMachine({
      machineCode: m.code,
      machineDisplay: m.display,
    })

    const local = decodeLicenseText(value, m.code)
    if (!local.payload) {
      return { ok: false, error: local.error || '激活码无效', state }
    }

    const localData = localPayloadData(local.payload, Date.now())
    if (localData.status === 'expired') {
      return {
        ok: false,
        error: '激活码已过期',
        state: setState(stateFromData(localData, m.code, { offline: true })),
      }
    }

    try {
      const online = await requestCheckin({
        mid: m.code,
        license: value,
        installId: await getInstallId(),
        appVersion,
      })
      const status = STATUS_MESSAGES[online.data.status] ? online.data.status : 'none'
      if (status !== 'active' && status !== 'pending') {
        if (status === 'revoked') {
          clearLicenseText()
          clearStateCache()
        }
        return {
          ok: false,
          error:
            status === 'trial'
              ? '激活码未在授权中心登记'
              : online.data.message || STATUS_MESSAGES[status] || '激活失败',
          state,
        }
      }

      saveLicenseText(value)
      writeStateCache(online.payload, online.sig)
      lastSuccessMono = performance.now()
      const next = setState(stateFromData(online.data, m.code))
      schedule()
      return { ok: true, state: next }
    } catch (error) {
      if (error.code === 'bad_request') {
        return { ok: false, error: error.message, state }
      }

      saveLicenseText(value)
      lastSuccessMono = performance.now()
      const next = setState(
        stateFromData(localData, m.code, {
          offline: true,
          warning: '暂时无法连接授权服务器，已按离线激活码放行',
        }),
      )
      schedule()
      return { ok: true, state: next }
    }
  }

  function reset() {
    clearLicenseText()
    clearStateCache()
    const next = setMachine({
      phase: 'ready',
      status: 'none',
      allowed: false,
      message: '已清除本地授权',
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
      serverTime: Date.now(),
      graceUntil: 0,
      checkedAt: Date.now(),
    })
    schedule()
    return next
  }

  function start() {
    if (!firstRun) firstRun = refresh()
    return firstRun
  }

  async function ready() {
    if (!firstRun) start()
    await firstRun
    return state
  }

  function poke() {
    if (performance.now() - lastSuccessMono < POLICY.wakeMinGapMs) return Promise.resolve(state)
    return refresh()
  }

  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  function getState() {
    return state
  }

  const service = {
    start,
    ready,
    refresh,
    activate,
    reset,
    poke,
    stop,
    getState,
    machine: ensureMachine,
    get baseUrl() {
      return base
    },
    onUpdate: onUpdateHandler,
  }

  return service
}

module.exports = {
  createLicenseService,
  verifyEnvelope,
  decodeLicenseText,
  localStatus,
  normalizeMid,
  POLICY,
  PRODUCT,
}
