// 导出「案例模板」：产出 resources/cases.zip（随安装包内置，客户端首次使用本地解压，无需联网）。
//
// 来源优先级：
//   1) backend/cases/<name>/ 已构建好的案例目录（case.json + assets/ + output/ + cover.*）—— 直接打包；
//   2) 不存在时，退回从 backend/data（记录分组 + 参考图 + 成片）现场生成。
//
// 产出结构：<name>/case.json、<name>/assets/*、<name>/output/*、<name>/cover.*
// 用法：node scripts/export-cases.mjs   （release.mjs 会在打包前自动调用）
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
const builtCasesDir = path.join(backendDir, 'cases')

// 现场生成时的案例清单（仅在 backend/cases 缺失时使用）：
//   name=分组名；cover: 'stitch' = data/case/<name>/output 的成片；'latest' = 该分组最新的一条成功成片
const CASES = [
  { name: '包大人严选', cover: 'latest' },
  { name: '富士-A5', cover: 'latest' },
  { name: '耳间万生', cover: 'stitch' },
  { name: '儿时', cover: 'stitch' },
]

const outDir = path.join(frontendDir, 'resources')
const zipPath = path.join(outDir, 'cases.zip')

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

let exported = 0
let totalShots = 0
let tarDir = null
let tarNames = []
let staging = null

// —— 场景一：直接打包已构建好的 backend/cases ——
const prebuilt = fs.existsSync(builtCasesDir)
  ? fs
      .readdirSync(builtCasesDir)
      .filter((n) => fs.existsSync(path.join(builtCasesDir, n, 'case.json')))
  : []

if (prebuilt.length > 0) {
  tarDir = builtCasesDir
  for (const name of prebuilt) {
    tarNames.push(name)
    const meta = readJson(path.join(builtCasesDir, name, 'case.json'), {})
    const shots = (meta.shots || []).length
    exported += 1
    totalShots += shots
    console.log(`[export-cases] ${name}：${shots} 镜头（内置目录）`)
  }
} else {
  // —— 场景二：从 backend/data 现场生成 ——
  const jobs = Object.values(readJson(path.join(dataDir, 'jobs.json'), {}))
  const assets = readJson(path.join(dataDir, 'assets.json'), {})
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jue-cases-'))
  tarDir = staging

  const assetPath = (id) => {
    const a = assets[id]
    return a && a.path && fs.existsSync(a.path) ? a.path : null
  }

  const copyInto = (src, destDir, base) => {
    if (!src || !fs.existsSync(src)) return null
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, path.join(destDir, base))
    return base
  }

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
    const outShotDir = path.join(caseDir, 'output')
    const astDir = path.join(caseDir, 'assets')
    fs.mkdirSync(outShotDir, { recursive: true })

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
      copyInto(j.output, outShotDir, path.basename(j.output))
    }

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
    tarNames.push(c.name)
    console.log(`[export-cases] ${c.name}：${shots.length} 镜头`)
  }
}

if (exported === 0) {
  if (staging) fs.rmSync(staging, { recursive: true, force: true })
  console.error(
    '[export-cases] 未导出任何案例：请检查 backend/cases 或 backend/data（含 CASES 配置）',
  )
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
if (fs.existsSync(zipPath)) fs.rmSync(zipPath)
// 用系统 tar（bsdtar）打 zip，免额外依赖
const r = spawnSync(
  'tar',
  ['-a', '-c', '-f', zipPath, '-C', tarDir, ...tarNames],
  { stdio: 'inherit' },
)
if (staging) fs.rmSync(staging, { recursive: true, force: true })
if (r.status !== 0 || !fs.existsSync(zipPath)) {
  console.error('[export-cases] 打包 cases.zip 失败')
  process.exit(1)
}
const mb = (fs.statSync(zipPath).size / 1048576).toFixed(1)
console.log(
  `[export-cases] → ${zipPath}（${exported} 个案例 / ${totalShots} 镜头 / ${mb} MB）`,
)
