// 机器码：采集本机硬件标识（主板/CPU/磁盘/主机 UUID）→ SHA256 → 16 位十六进制。
// 用于「一码一机」的离线授权绑定。同一台机器结果稳定，重装系统一般不变。
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

function hashToCode(raw) {
  const hex = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase()
  return hex.slice(0, 16)
}

function formatCode(code) {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', () => resolve({ out: '', err: 'spawn failed' }))
    child.on('close', () => resolve({ out, err }))
  })
}

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "'UUID=' + (Get-CimInstance Win32_ComputerSystemProduct).UUID;",
  "'BOARD=' + (Get-CimInstance Win32_BaseBoard).SerialNumber;",
  "'CPU=' + (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId;",
  "'DISK=' + (Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber;",
].join(' ')

function fallbackRaw() {
  const nics = os.networkInterfaces()
  const macs = []
  for (const name of Object.keys(nics)) {
    for (const nic of nics[name] || []) {
      if (!nic.internal && nic.mac && nic.mac !== '00:00:00:00:00:00') {
        macs.push(nic.mac)
      }
    }
  }
  return [os.hostname(), os.machine(), os.platform(), ...macs.sort()].join('|')
}

async function collectRaw() {
  const parts = []
  try {
    const { out } = await runPowerShell(PS_SCRIPT)
    for (const line of out.split(/\r?\n/)) {
      const value = line.slice(line.indexOf('=') + 1).trim()
      if (value && value.toLowerCase() !== 'none' && value !== '0') {
        parts.push(line.trim())
      }
    }
  } catch {
    /* ignore */
  }

  if (parts.length === 0) {
    parts.push(fallbackRaw())
  }
  return parts.join('|')
}

let cached = null

async function getMachineCode() {
  if (cached) return cached
  const raw = await collectRaw()
  const code = hashToCode(raw)
  cached = { raw, code, display: formatCode(code) }
  return cached
}

module.exports = { getMachineCode, formatCode }
