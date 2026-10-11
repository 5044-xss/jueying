// 离线激活：用内嵌 Ed25519 公钥验证激活码签名，并绑定本机机器码。
// 激活码格式：base64url(payload) + "." + base64url(signature)
// payload = { mid, v, issuedAt }，mid 为机器码（16 位十六进制）。
const fs = require('node:fs')
const crypto = require('node:crypto')
const { publicKey } = require('./license-public.cjs')

let cachedKey = null

function getPublicKey() {
  if (cachedKey) return cachedKey
  cachedKey = crypto.createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    type: 'spki',
    format: 'der',
  })
  return cachedKey
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function verifyLicense(code, machineCode) {
  if (!code || typeof code !== 'string') {
    return { ok: false, error: '激活码为空' }
  }
  const trimmed = code.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) {
    return { ok: false, error: '激活码格式不正确' }
  }
  const payloadPart = trimmed.slice(0, dot)
  const sigPart = trimmed.slice(dot + 1)

  let valid = false
  try {
    valid = crypto.verify(
      null,
      Buffer.from(payloadPart, 'utf8'),
      getPublicKey(),
      Buffer.from(sigPart, 'base64url'),
    )
  } catch {
    valid = false
  }
  if (!valid) {
    return { ok: false, error: '激活码签名无效' }
  }

  let payload
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart))
  } catch {
    return { ok: false, error: '激活码内容损坏' }
  }
  if (!payload || typeof payload.mid !== 'string') {
    return { ok: false, error: '激活码内容不完整' }
  }
  if (payload.mid.toUpperCase() !== String(machineCode).toUpperCase()) {
    return { ok: false, error: '激活码与本机不匹配' }
  }
  return { ok: true, payload }
}

function loadLicense(licensePath) {
  try {
    if (!fs.existsSync(licensePath)) return null
    return fs.readFileSync(licensePath, 'utf8').trim() || null
  } catch {
    return null
  }
}

function saveLicense(licensePath, code) {
  fs.mkdirSync(require('node:path').dirname(licensePath), { recursive: true })
  fs.writeFileSync(licensePath, code.trim(), 'utf8')
}

function clearLicense(licensePath) {
  try {
    if (fs.existsSync(licensePath)) fs.rmSync(licensePath, { force: true })
  } catch {
    /* ignore */
  }
}

module.exports = { verifyLicense, loadLicense, saveLicense, clearLicense }
