// 导出「案例模板」：从本机 backend/data 抽取配置的案例，产出 release/cases.zip。
//
// 案例来源 = 「记录」里的分组（jobs.json 的 project）+ 参考图（assets.json）+ 成片（output）。
// 产出结构：
//   <name>/case.json   每个镜头：name / prompt / params / images / firstFrame / lastFrame / video
//   <name>/assets/*    参考图
//   <name>/output/*    成片
//   <name>/cover.*     演示视频
//
// 用法：node scripts/export-cases.mjs   （release.mjs 会自动调用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '..')
const backendDir =
  process.env.JUEMAN_BACKEND_DIR || path.resolve(frontendDir, '..', 'backend')
const dataDir = path.join(backendDir, 'data')

// 要导出的案例：name=分组名；cover 取演示视频来源
//   'stitch' = data/case/<name>/output 里的成片（合成视频）
//   'latest' = 该分组最新的一条成功成片
const CASES = [
  { name: '包大人严选', cover: 'latest' },
  { name: '富士-A5', cover: 'latest' },
  { name: '耳间万生', cover: 'stitch' },
  { name: '儿时', cover: 'stitch' },
]

const releaseDir = path.join(frontendDir, 'release')
const zipPath = path.join(releaseDir, 'cases.zip')

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

const jobs = Object.values(readJson(path.join(dataDir, 'jobs.json'), {}))
const assets = readJson(path.join(dataDir, 'assets.json'), {})

function assetPath(id) {
  const a = assets[id]
  return a && a.path && fs.existsSync(a.path) ? a.path : null
}

function copyInto(src, destDir, base) {
  if (!src || !fs.existsSync(src)) return null
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, path.join(destDir, base))
  return base
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jue-cases-'))
let exported = 0
let totalShots = 0

for (const c of CASES) {
  const shotsRaw = jobs
    .filter(
      (j) =>
        (j.project || '') === c.name &&
        j.state === 'success' &&
        j.output &&
        fs.existsSync(j.output),
    )
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  if (shotsRaw.length === 0) {
    console.warn(`[export-cases] 跳过「${c.name}」：该分组没有成功成片`)
    continue
  }

  const caseDir = path.join(staging, c.name)
  const outDir = path.join(caseDir, 'output')
  const astDir = path.join(caseDir, 'assets')
  fs.mkdirSync(outDir, { recursive: true })

  const usedAsset = new Map()
  const importAsset = (id) => {
    if (!id) return null
    if (usedAsset.has(id)) return usedAsset.get(id)
    const src = assetPath(id)
    if (!src) return null
    const rel = 'assets/' + copyInto(src, astDir, path.basename(src))
    usedAsset.set(id, rel)
    return rel
  }

  const shots = []
  for (const j of shotsRaw) {
    const inp = j.inputs || {}
    shots.push({
      name: j.name || c.name,
      prompt: j.prompt || '',
      params: j.params || {},
      images: (inp.images || []).map(importAsset).filter(Boolean),
      firstFrame: importAsset(inp.firstFrame),
      lastFrame: importAsset(inp.lastFrame),
      video: 'output/' + path.basename(j.output),
    })
    copyInto(j.output, outDir, path.basename(j.output))
  }

  // 演示视频
  let coverSrc = null
  if (c.cover === 'stitch') {
    const sdir = path.join(dataDir, 'case', c.name, 'output')
    if (fs.existsSync(sdir)) {
      const v = fs.readdirSync(sdir).find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
      if (v) coverSrc = path.join(sdir, v)
    }
  }
  if (!coverSrc) coverSrc = shotsRaw[shotsRaw.length - 1].output

  let coverRel = ''
  if (coverSrc && fs.existsSync(coverSrc)) {
    const ext = path.extname(coverSrc) || '.mp4'
    fs.copyFileSync(coverSrc, path.join(caseDir, 'cover' + ext))
    coverRel = 'cover' + ext
  }

  fs.writeFileSync(
    path.join(caseDir, 'case.json'),
    JSON.stringify({ name: c.name, cover: coverRel, shots }, null, 2),
    'utf8',
  )
  exported += 1
  totalShots += shots.length
  console.log(`[export-cases] ${c.name}：${shots.length} 镜头`)
}

if (exported === 0) {
  console.error('[export-cases] 未导出任何案例，请检查 CASES 配置与 backend/data')
  process.exit(1)
}

fs.mkdirSync(releaseDir, { recursive: true })
if (fs.existsSync(zipPath)) fs.rmSync(zipPath)
// 用系统 tar（bsdtar）打 zip，免额外依赖
const r = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', staging, '.'], {
  stdio: 'inherit',
})
fs.rmSync(staging, { recursive: true, force: true })
if (r.status !== 0 || !fs.existsSync(zipPath)) {
  console.error('[export-cases] 打包 cases.zip 失败')
  process.exit(1)
}
const mb = (fs.statSync(zipPath).size / 1048576).toFixed(1)
console.log(`[export-cases] → ${zipPath}（${exported} 个案例 / ${totalShots} 镜头 / ${mb} MB）`)
