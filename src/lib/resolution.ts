import type { Aspect } from '@/core/types'

// H3 原生上限 768p（≈0.98MP）；只给有效档位，超过是“虚胖”。
export const RESOLUTIONS = ['0.4', '0.5', '0.7', '0.98']
export const DURATIONS = Array.from({ length: 12 }, (_, i) => i + 4)
export const MAX_MP = 0.98

export const RATIOS: Record<Aspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
}

const NATIVE_DIMS: Record<string, [number, number]> = {
  '16:9|0.4': [864, 480],
  '16:9|0.5': [960, 544],
  '16:9|0.7': [1088, 608],
  '16:9|0.98': [1312, 736],
  '16:9|1': [1344, 768],
  '16:9|1.5': [1600, 896],
  '16:9|2': [1920, 1088],
  '9:16|0.4': [480, 864],
  '9:16|0.5': [544, 960],
  '9:16|0.7': [608, 1088],
  '9:16|0.98': [736, 1312],
  '9:16|1': [768, 1344],
  '9:16|1.5': [896, 1600],
  '9:16|2': [1088, 1920],
}

export function resDims(res: string, aspect: Aspect): [number, number] {
  const native = NATIVE_DIMS[`${aspect}|${res}`]
  if (native) return native
  const mp = Math.min(parseFloat(res) || 0.5, MAX_MP)
  const ratio = RATIOS[aspect] || 16 / 9
  const area = mp * 1_000_000
  const w = Math.max(256, Math.min(5760, Math.floor(Math.sqrt(area * ratio) / 32) * 32))
  const h = Math.max(256, Math.min(5760, Math.floor(Math.sqrt(area / ratio) / 32) * 32))
  return [w, h]
}

// 把短边像素归一到用户看得懂的档位（540P / 768P / 1080P 之类）
export function friendlyP(res: string, aspect: Aspect): number {
  const short = Math.min(...resDims(res, aspect))
  const buckets = [360, 480, 540, 768, 900, 1080, 1440]
  return buckets.find((b) => Math.abs(b - short) / b < 0.07) ?? short
}

export function resolutionLabel(res: string, aspect: Aspect): string {
  return `${friendlyP(res, aspect)}P`
}
