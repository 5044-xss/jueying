const os = require('node:os')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

function hashToCode(raw) {
  const hex = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase()
  return hex.slice(0, 16)
}

function formatCode(code) {
  return String(code).replace(/(.{4})(?=.)/g, '$1-')
}

function run(command, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : String(stdout || '')),
    )
  })
}

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "'UUID=' + (Get-CimInstance Win32_ComputerSystemProduct).UUID;",
  "'BOARD=' + (Get-CimInstance Win32_BaseBoard).SerialNumber;",
  "'CPU=' + (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId;",
  "'DISK=' + (Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } | Select-Object -First 1).SerialNumber;",
].join(' ')

async function collectWindows() {
  const out = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    PS_SCRIPT,
  ])
  const parts = []
  for (const line of out.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index < 0) continue
    const value = line.slice(index + 1).trim()
    if (!value || value.toLowerCase() === 'none' || value === '0') continue
    parts.push(line.trim())
  }
  return parts
}

async function collectMac() {
  const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
  const parts = []
  const uuid = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i)?.[1]
  const serial = out.match(/"IOPlatformSerialNumber"\s*=\s*"([^"]+)"/i)?.[1]
  const board = out.match(/"board-id"\s*=\s*<"([^"]+)">/i)?.[1]
  if (uuid) parts.push(`UUID=${uuid}`)
  if (serial) parts.push(`SN=${serial}`)
  if (board) parts.push(`BOARD=${board}`)
  return parts
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function collectLinux() {
  const parts = []
  const machineId = readFileSafe('/etc/machine-id') || readFileSafe('/var/lib/dbus/machine-id')
  const productUuid = readFileSafe('/sys/class/dmi/id/product_uuid')
  const boardSerial = readFileSafe('/sys/class/dmi/id/board_serial')
  const productSerial = readFileSafe('/sys/class/dmi/id/product_serial')
  if (machineId) parts.push(`UUID=${machineId}`)
  if (productUuid) parts.push(`DMI=${productUuid}`)
  if (boardSerial) parts.push(`BOARD=${boardSerial}`)
  if (productSerial) parts.push(`SN=${productSerial}`)
  try {
    for (const name of fs.readdirSync('/sys/block').sort()) {
      if (/^(loop|ram|zram|sr)/.test(name)) continue
      const serial =
        readFileSafe(`/sys/block/${name}/device/serial`) || readFileSafe(`/sys/block/${name}/serial`)
      if (serial) {
        parts.push(`DISK=${serial}`)
        break
      }
    }
  } catch {
  }
  return parts
}

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
  let parts = []
  try {
    if (process.platform === 'win32') parts = await collectWindows()
    else if (process.platform === 'darwin') parts = await collectMac()
    else parts = collectLinux()
  } catch {
    parts = []
  }
  if (parts.length === 0) parts.push(fallbackRaw())
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
