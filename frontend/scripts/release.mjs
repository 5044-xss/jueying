// 发版：可选升版本 → 构建（后端 exe + 前端 + 安装包）→ 提交打 tag 推送 → 创建 GitHub Release。
//
//   npm run release                 # 用当前版本号发版
//   npm run release -- --bump patch  # 先升 patch 再发版（major|minor|patch 或 x.y.z）
//   npm run release -- --notes "更新说明..."
//
// 前置：已安装并登录 gh（gh auth login），且有 origin 推送权限。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const REPO = '5044-xss/jueying'

function sh(cmd) {
  console.log(`\n$ ${cmd}`)
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: root })
  if (r.error || r.status !== 0) {
    console.error(`\n✗ 命令失败（exit ${r.status}）：${cmd}`)
    process.exit(r.status ?? 1)
  }
}
function shOut(cmd) {
  return (spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8' }).stdout || '').trim()
}

const args = process.argv.slice(2)
let bump = null
let notes = ''
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--bump') bump = args[i + 1]
  else if (args[i] === '--notes') notes = args[i + 1]
}

const pkgPath = path.join(root, 'package.json')
const lockPath = path.join(root, 'package-lock.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

if (bump) {
  const [maj, min, pat] = String(pkg.version).split('.').map((n) => parseInt(n, 10) || 0)
  let v
  if (bump === 'major') v = `${maj + 1}.0.0`
  else if (bump === 'minor') v = `${maj}.${min + 1}.0`
  else if (bump === 'patch') v = `${maj}.${min}.${pat + 1}`
  else if (/^\d+\.\d+\.\d+$/.test(bump)) v = bump
  else {
    console.error('--bump 需为 patch|minor|major 或 x.y.z')
    process.exit(1)
  }
  pkg.version = v
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  lock.version = v
  if (lock.packages && lock.packages['']) lock.packages[''].version = v
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  console.log(`版本 → ${v}`)
}

const tag = `v${pkg.version}`

if (shOut(`git tag -l ${tag}`)) {
  console.error(`✗ tag ${tag} 已存在，先改版本号或用 --bump。`)
  process.exit(1)
}

if (spawnSync('gh auth status', { shell: true, cwd: root, stdio: 'ignore' }).status !== 0) {
  console.error('✗ 未登录 GitHub CLI，请先运行： gh auth login')
  process.exit(1)
}

// 构建：后端 exe + 前端 + electron-builder（产出 release/）
sh('npm run package')

// 提交版本改动 + 打 tag + 推送
if (shOut('git status --porcelain')) {
  sh('git add -A')
  sh(`git commit -m "release: ${tag}"`)
}
sh(`git tag ${tag}`)
sh('git push origin HEAD')
sh(`git push origin ${tag}`)

// 创建 Release 并上传安装包
const relDir = path.join(root, 'release')
const assets = fs.existsSync(relDir)
  ? fs
      .readdirSync(relDir)
      .filter((f) => {
        // latest.yml / *.yml 等更新元数据不带版本号，必须一起上传（自动更新依赖它）
        if (/\.(yml|yaml)$/i.test(f)) return true
        if (/\.(exe|blockmap)$/i.test(f)) return f.includes(pkg.version)
        return false
      })
      .map((f) => `"release/${f}"`)
  : []
const note = notes || `掘影 ${tag}`
sh(`gh release create ${tag} ${assets.join(' ')} --repo ${REPO} -t "掘影 ${tag}" -n ${JSON.stringify(note)}`)
console.log(`\n✓ 已发布 https://github.com/${REPO}/releases/tag/${tag}`)
