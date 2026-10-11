// 生成 Ed25519 密钥对，用于离线激活码签发/验签。
// 私钥写入 keys/（勿入库、勿随安装包分发）；公钥内嵌到 electron/license-public.cjs。
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keysDir = path.join(root, 'keys')
const electronDir = path.join(root, 'electron')

fs.mkdirSync(keysDir, { recursive: true })
fs.mkdirSync(electronDir, { recursive: true })

const privatePath = path.join(keysDir, 'license-private.pem')
const publicPath = path.join(keysDir, 'license-public.pem')

if (fs.existsSync(privatePath)) {
  console.error(`✗ 私钥已存在：${privatePath}`)
  console.error('  如确认要重新签发（将导致旧激活码全部失效），请先手动删除该文件。')
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const publicDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

fs.writeFileSync(privatePath, privatePem, 'utf8')
fs.writeFileSync(publicPath, publicPem, 'utf8')

const pubModule = `// 自动生成于 scripts/gen-keypair.mjs，请勿手改。
// Ed25519 公钥（SPKI DER，base64）。用于激活码离线验签。
module.exports = {
  publicKey:
    "${publicDerB64}",
};
`
fs.writeFileSync(path.join(electronDir, 'license-public.cjs'), pubModule, 'utf8')

console.log('✓ 已生成密钥对：')
console.log(`  私钥（保密，勿入库）：${privatePath}`)
console.log(`  公钥（留存备份）：    ${publicPath}`)
console.log(`  内嵌公钥：            ${path.join(electronDir, 'license-public.cjs')}`)
