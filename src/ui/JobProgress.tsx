import type { ShotState } from '@/core/types'
import { cn } from '@/lib/utils'

export function JobProgress({
  state,
  progress,
  className,
}: {
  state: ShotState
  progress?: number
  className?: string
}) {
  if (state !== 'queued' && state !== 'running') return null
  const indeterminate =
    state === 'queued' || typeof progress !== 'number' || progress <= 0
  const width = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-line/60', className)}>
      {indeterminate ? (
        <i className="block h-full w-1/3 animate-indeterminate rounded-full bg-ink/60" />
      ) : (
        <i
          className="block h-full rounded-full bg-ink transition-all duration-500"
          style={{ width: `${width}%` }}
        />
      )}
    </div>
  )
}
