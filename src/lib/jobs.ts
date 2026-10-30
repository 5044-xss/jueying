import type { Project, Shot, ShotState } from '@/core/types'

export function isActiveShot(shot: Shot): boolean {
  return shot.state === 'queued' || shot.state === 'running'
}

export interface ActiveJob {
  project: Project
  shot: Shot
}

export function activeJobs(projects: Project[]): ActiveJob[] {
  return projects
    .flatMap((project) =>
      project.shots.filter(isActiveShot).map((shot) => ({ project, shot })),
    )
    .sort((a, b) => a.shot.createdAt - b.shot.createdAt)
}

export function elapsedText(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export const STATE_LABEL: Record<ShotState, string> = {
  queued: '排队中',
  running: '生成中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
}

export const STATE_CLASS: Record<ShotState, string> = {
  queued: 'border-line bg-canvas text-warn',
  running: 'border-line bg-canvas text-warn',
  success: 'border-line bg-canvas text-ok',
  error: 'border-err/30 bg-canvas text-err',
  cancelled: 'border-line bg-canvas text-dim',
}
