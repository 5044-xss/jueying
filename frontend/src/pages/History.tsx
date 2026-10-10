import { ChevronDown, Clock, Play, RefreshCw, RotateCw, X } from 'lucide-react'
import { useState } from 'react'
import { useCancelJob, useCreateJob, useJobs } from '../api/queries'
import type { Job, JobForm, JobState } from '../api/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Spinner } from '../components/ui/Spinner'
import { VideoPlayer } from '../components/VideoPlayer'
import { readJobMeta } from '../lib/jobMeta'
import { formatTime } from '../lib/utils'
import { toast } from '../store/toast'
import { useUI } from '../store/ui'

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

const PAGE_SIZE = 10

export function HistoryPage() {
  const { data: jobs, isLoading, isError, error, refetch, isFetching } = useJobs(5000)
  const cancelJob = useCancelJob()
  const createJob = useCreateJob()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const total = jobs?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const cur = Math.min(page, pageCount - 1)
  const pageJobs = (jobs ?? []).slice(
    cur * PAGE_SIZE,
    cur * PAGE_SIZE + PAGE_SIZE,
  )

  const imageOrder = useUI((s) => s.imageOrder)
  const audioIds = useUI((s) => s.audioIds)
  const setView = useUI((s) => s.setView)

  async function onCancel(job: Job) {
    setBusyId(job.id)
    try {
      await cancelJob.mutateAsync(job.id)
      toast.info('已发送取消指令')
    } catch (e) {
      toast.error(`取消失败：${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function onRerun(job: Job) {
    setBusyId(job.id)
    try {
      const p = job.params || {}
      await createJob.mutateAsync({
        prompt: job.prompt,
        title: (job.name || 'clip') + '-r',
        duration: p.duration,
        aspect: p.aspect,
        resolution: p.resolution,
        images: imageOrder,
        audios: audioIds,
        samplerMode: p.sampler_mode || null,
      })
      toast.success('已按当前素材重跑（参考图沿用生成台中的选择）')
    } catch (e) {
      toast.error(`重跑失败：${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  function onLoadToGenerator(job: Job) {
    const ui = useUI.getState()
    const meta = readJobMeta(job.id)
    if (meta) {
      ui.loadDraft({
        prompt: meta.prompt,
        imageOrder: meta.images,
        audioIds: meta.audios,
        firstFrame: meta.firstFrame,
        lastFrame: meta.lastFrame,
      })
      ui.setPendingForm(meta.form)
    } else {
      ui.loadDraft({
        prompt: job.prompt,
        imageOrder: [],
        audioIds: [],
        firstFrame: null,
        lastFrame: null,
      })
      const patch: Partial<JobForm> = {}
      const p = job.params || {}
      if (p.duration) patch.duration = p.duration
      if (p.aspect) patch.aspect = p.aspect as JobForm['aspect']
      if (p.resolution) patch.resolution = p.resolution
      ui.setPendingForm(patch)
    }
    ui.setCurrentJobId(job.id)
    setView('generator')
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-dim">
        <Spinner className="h-4 w-4" /> 加载历史…
      </div>
    )
  }
  if (isError) {
    return <div className="text-err">加载失败：{(error as Error).message}</div>
  }

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <div className="flex items-center gap-3">
        <h2 className="section-title">任务列表</h2>
        <Badge>{total} 条</Badge>
        <Button className="ml-auto" size="sm" onClick={() => void refetch()}>
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> 刷新
        </Button>
      </div>

      {total === 0 && (
        <Card className="flex items-center gap-2 text-dim">
          <Clock size={15} /> 暂无生成记录。
        </Card>
      )}

      {total > 0 && (
        <>
          <div className="flex max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pr-1">
            {pageJobs.map((job) => {
        const p = job.params || {}
        const running = job.state === 'running' || job.state === 'queued'
        return (
          <Card key={job.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stateTone[job.state]}>{stateText[job.state]}</Badge>
              <span className="font-semibold">{job.name}</span>
              <span className="text-xs text-dim">
                {p.duration ? `${p.duration}s` : ''} {p.aspect || ''}{' '}
                {p.resolution ? `${p.resolution}MP` : ''}
              </span>
              <span className="text-xs text-dim/70">
                {formatTime(job.createdAt)}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {running && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void onCancel(job)}
                    disabled={busyId === job.id}
                  >
                    <X size={13} /> 取消
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => void onRerun(job)}
                  disabled={busyId === job.id}
                  title="用当前生成台中的素材重跑"
                >
                  <RotateCw size={13} /> 重跑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onLoadToGenerator(job)}
                  title="载入提示词与任务到生成台"
                >
                  <Play size={13} /> 载入
                </Button>
                {job.state === 'success' && job.videoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setExpanded(expanded === job.id ? null : job.id)
                    }
                  >
                    <ChevronDown
                      size={13}
                      className={expanded === job.id ? 'rotate-180' : ''}
                    />
                    成片
                  </Button>
                )}
              </div>
            </div>

            {job.message && (
              <div className="text-xs text-dim">{job.message}</div>
            )}
            {job.error && (
              <div className="whitespace-pre-wrap rounded-2xl border border-err/30 bg-err/10 px-3.5 py-2.5 text-xs text-err">
                {job.error}
              </div>
            )}

            {expanded === job.id && job.state === 'success' && (
              <VideoPlayer jobId={job.id} />
            )}
          </Card>
        )
            })}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              size="sm"
              onClick={() => setPage(Math.max(0, cur - 1))}
              disabled={cur === 0}
            >
              上一页
            </Button>
            <span className="text-xs text-dim">
              第 {cur + 1} / {pageCount} 页 · 共 {total} 条
            </span>
            <Button
              size="sm"
              onClick={() => setPage(Math.min(pageCount - 1, cur + 1))}
              disabled={cur >= pageCount - 1}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
