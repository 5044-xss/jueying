import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Job, JobState } from '../api/types'
import { formatBytes, percent } from '../lib/utils'
import { Badge } from './ui/Badge'
import { ProgressBar } from './ui/ProgressBar'
import { VideoPlayer } from './VideoPlayer'

const stateText: Record<JobState, string> = {
  running: '生成中',
  queued: '排队中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
}

const stateTone = {
  running: 'acc',
  queued: 'acc',
  success: 'ok',
  error: 'err',
  cancelled: 'warn',
} as const

export function JobProgress({
  job,
  connected,
  onCancel,
  cancelling,
}: {
  job: Job | null
  connected: boolean
  onCancel?: () => void
  cancelling?: boolean
}) {
  if (!job) {
    return (
      <div className="rounded-2xl border border-line bg-soft px-3.5 py-3 text-sm text-dim">
        尚未提交任务。
      </div>
    )
  }

  const running = job.state === 'running' || job.state === 'queued'
  const p = job.progress || { bytes: 0, total: 0 }
  const pct = percent(p.bytes, p.total)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={stateTone[job.state]}>{stateText[job.state]}</Badge>
        {running && (
          <span className="text-xs text-dim">
            {connected ? '实时推送' : '轮询'} · {job.message}
          </span>
        )}
        {!running && job.message && (
          <span className="text-xs text-dim">{job.message}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {job.promptId && (
            <span className="truncate text-[11px] text-dim/60">
              prompt {job.promptId}
            </span>
          )}
          {running && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="btn px-3 py-1 text-xs"
            >
              <X size={13} /> 取消
            </button>
          )}
        </div>
      </div>

      {running && (
        <>
          <ProgressBar indeterminate={!p.total} value={pct} />
          {p.total > 0 && (
            <div className="text-xs text-dim">
              回传中 {pct}% · {formatBytes(p.bytes)} / {formatBytes(p.total)}
            </div>
          )}
        </>
      )}

      {job.error && (
        <div className="whitespace-pre-wrap rounded-2xl border border-err/30 bg-err/10 px-3.5 py-2.5 text-xs text-err">
          {job.error}
        </div>
      )}

      {job.state === 'success' && job.videoUrl && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <VideoPlayer jobId={job.id} />
        </motion.div>
      )}
    </div>
  )
}
