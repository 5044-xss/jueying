import { z } from 'zod'
import type { CasePack, Project, Shot } from './types'
import { DEFAULT_PARAMS } from './types'
import { newId } from './id'

export const PACK_SCHEMA_VERSION = 1

export const ParamsSchema = z.record(z.string(), z.unknown())

export const PackShotSchema = z.object({
  order: z.number().int().positive().optional(),
  name: z.string().optional(),
  prompt: z.string().default(''),
  params: ParamsSchema.default({}),
  images: z.array(z.string()).default([]),
  firstFrame: z.string().nullable().optional(),
  lastFrame: z.string().nullable().optional(),
  video: z.string().nullable().optional(),
})

export const PackSchema = z.object({
  schema: z.literal(PACK_SCHEMA_VERSION),
  kind: z.enum(['case', 'project']).default('case'),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  author: z.string().optional(),
  description: z.string().optional(),
  cover: z.string().optional(),
  createdAt: z.number().optional(),
  defaultParams: ParamsSchema.default({}),
  shots: z.array(PackShotSchema).default([]),
})

export type Pack = z.infer<typeof PackSchema>
export type PackShot = z.infer<typeof PackShotSchema>
export type PackVideo = { url: string; path: string }
export type PackVideoMap = Map<string, PackVideo>

export function parsePack(input: unknown): Pack {
  return PackSchema.parse(input)
}

export function packToCase(pack: Pack, videos?: PackVideoMap): CasePack {
  return {
    id: newId('case'),
    name: pack.name,
    author: pack.author,
    version: pack.version,
    description: pack.description,
    defaultParams: pack.defaultParams,
    importedAt: Date.now(),
    shots: pack.shots.map((s, i) => {
      const local = s.video ? videos?.get(s.video) : undefined
      return {
        order: s.order ?? i + 1,
        name: s.name ?? `视频 ${i + 1}`,
        prompt: s.prompt,
        params: s.params,
        images: s.images,
        firstFrame: s.firstFrame ?? null,
        lastFrame: s.lastFrame ?? null,
        video: local?.url ?? s.video ?? null,
        videoPath: local?.path ?? null,
      }
    }),
  }
}

export function packToProject(pack: Pack, videos?: PackVideoMap): Project {
  const id = newId('proj')
  const now = Date.now()
  const shots: Shot[] = pack.shots
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => {
      const local = s.video ? videos?.get(s.video) : undefined
      const remote = s.video && /^https?:/i.test(s.video) ? s.video : undefined
      return {
        id: newId('shot'),
        projectId: id,
        name: s.name ?? `视频 ${i + 1}`,
        prompt: s.prompt,
        params: { ...DEFAULT_PARAMS, ...(pack.defaultParams as object), ...(s.params as object) },
        state: 'success',
        images: s.images.map((path) => ({ id: newId('media'), name: path, path })),
        firstFrame: null,
        lastFrame: null,
        output: local?.url ?? remote,
        outputPath: local?.path,
        createdAt: now,
        finishedAt: now,
      }
    })

  return {
    id,
    name: pack.name,
    origin: pack.kind === 'case' ? 'case' : 'import',
    defaultParams: { ...DEFAULT_PARAMS, ...(pack.defaultParams as object) },
    shots,
    createdAt: now,
    updatedAt: now,
  }
}

export function caseToProject(pack: CasePack): Project {
  const id = newId('proj')
  const now = Date.now()
  const shots: Shot[] = pack.shots
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      id: newId('shot'),
      projectId: id,
      name: s.name || `视频 ${i + 1}`,
      prompt: s.prompt,
      params: { ...DEFAULT_PARAMS, ...(pack.defaultParams as object), ...(s.params as object) },
      state: 'success',
      images: s.images.map((path) => ({
        id: newId('media'),
        name: path.split('/').pop() || path,
        path,
      })),
      firstFrame: s.firstFrame ? { id: newId('media'), name: '首帧', path: s.firstFrame } : null,
      lastFrame: s.lastFrame ? { id: newId('media'), name: '尾帧', path: s.lastFrame } : null,
      output: s.video ?? undefined,
      outputPath: s.videoPath ?? undefined,
      createdAt: now,
      finishedAt: now,
    }))

  return {
    id,
    name: pack.name,
    origin: 'case',
    defaultParams: { ...DEFAULT_PARAMS, ...(pack.defaultParams as object) },
    shots,
    createdAt: now,
    updatedAt: now,
  }
}

function packPath(media: { name: string; path?: string }): string {
  if (media.path?.startsWith('local-media://')) return media.name
  return media.path ?? media.name
}

export function projectToPack(project: Project, opts: { withVideos?: boolean } = {}): Pack {
  return {
    schema: PACK_SCHEMA_VERSION,
    kind: 'project',
    name: project.name,
    version: '1.0.0',
    defaultParams: project.defaultParams as unknown as Record<string, unknown>,
    createdAt: project.createdAt,
    shots: project.shots.map((s, i) => ({
      order: i + 1,
      name: s.name,
      prompt: s.prompt,
      params: s.params as unknown as Record<string, unknown>,
      images: s.images.map(packPath),
      firstFrame: s.firstFrame ? packPath(s.firstFrame) : null,
      lastFrame: s.lastFrame ? packPath(s.lastFrame) : null,
      video:
        opts.withVideos && s.output && /^https?:/i.test(s.output) ? s.output : null,
    })),
  }
}
