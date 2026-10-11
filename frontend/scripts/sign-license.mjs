// 卖家签发工具：输入用户机器码 → 输出激活码。不随安装包分发。
// 用法：node scripts/sign-license.mjs <机器码>  或  直接运行后按提示输入。
import { createPrivateKey, sign } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const privatePath = path.join(root, 'keys', 'license-private.pem')

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function normalizeMid(input) {
  return input.trim().replace(/[-\s]/g, '').toUpperCase()
}

function signMachine(mid) {
  const normalized = normalizeMid(mid)
  if (!/^[0-9A-F]{16}$/.test(normalized)) {
    throw new Error(`机器码格式不正确（应为 16 位十六进制）：${mid}`)
  }
  const privateKey = createPrivateKey(fs.readFileSync(privatePath, 'utf8'))
  const payload = { mid: normalized, v: 1, issuedAt: new Date().toISOString() }
  const payloadPart = b64url(JSON.stringify(payload))
  const sig = sign(null, Buffer.from(payloadPart, 'utf8'), privateKey)
  return `${payloadPart}.${b64url(sig)}`
}

async function main() {
  if (!fs.existsSync(privatePath)) {
    console.error(`✗ 未找到私钥：${privatePath}`)
    console.error('  请先运行：node scripts/gen-keypair.mjs')
    process.exit(1)
  }

  const arg = process.argv[2]
  if (arg) {
    console.log(signMachine(arg))
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question('请输入用户机器码：', (answer) => {
    rl.close()
    try {
      console.log('\n激活码：\n' + signMachine(answer))
    } catch (err) {
      console.error(String(err.message ?? err))
      process.exit(1)
    }
  })
}

main()
