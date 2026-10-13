import {
  ChevronDown,
  Clock,
  Folder,
  Info,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  useCancelJob,
  useCreateJob,
  useDeleteJob,
  useDeleteProject,
  useJobs,
  useUpdateJob,
} from '../api/queries'
import type { Job, JobForm, JobState } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { Select } from '../components/ui/Select'
import { Spinner } from '../components/ui/Spinner'
import { VideoPlayer } from '../components/VideoPlayer'
import { readJobMeta } from '../lib/jobMeta'
import { cn, formatTime } from '../lib/utils'
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

const NEW_GROUP = '__new__'
const ALL = '__all__'
const NONE = '__none__'

const MODEL_VARIANT_TEXT: Record<string, string> = {
  auto: '自动',
  fl2va: 'FL2VA（纯图）',
  ref2va: 'Ref2VA（图+音/视频）',
}
const SAMPLER_MODE_TEXT: Record<string, string> = {
  new: '新链路（SaveVideo）',
  legacy: '旧链路（VHS）',
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === '' || value === false) {
    return null
  }
  return (
    <div className="flex items-start gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="w-24 shrink-0 text-xs text-dim/80">{label}</span>
      <span className="min-w-0 flex-1 break-all text-xs text-ink">{value}</span>
    </div>
  )
}

function jobDetail(job: Job) {
  const p = job.params || {}
  const seedFixed = typeof p.seed === 'number'
  return (
    <div className="max-h-[60vh] overflow-y-auto pr-1">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-dim">
        <Badge tone={stateTone[job.state]}>{stateText[job.state]}</Badge>
        <span>{formatTime(job.createdAt)}</span>
        <span className="text-dim/60">ID {job.id.slice(0, 8)}</span>
      </div>

      <DetailRow label="时长" value={p.duration ? `${p.duration} 秒` : ''} />
      <DetailRow
        label="帧数"
        value={p.length ? `${p.length} 帧（${p.duration ?? ''}s @24fps）` : ''}
      />
      <DetailRow
        label="分辨率"
        value={p.width && p.height ? `${p.width} × ${p.height}` : ''}
      />
      <DetailRow label="画幅" value={p.aspect || p.aspect_ratio} />
      <DetailRow
        label="清晰度"
        value={
          p.megapixels
            ? `${p.megapixels} MP`
            : p.resolution
              ? `${p.resolution} MP`
              : ''
        }
      />
      <DetailRow
        label="采样步数"
        value={
          p.video_steps
            ? `${p.video_steps}（视频）/ ${p.audio_steps ?? p.video_steps}（音频）`
            : ''
        }
      />
      <DetailRow
        label="采样链路"
        value={p.sampler_mode ? SAMPLER_MODE_TEXT[p.sampler_mode] ?? p.sampler_mode : '自动'}
      />
      <DetailRow
        label="模型路径"
        value={
          p.model_variant
            ? MODEL_VARIANT_TEXT[p.model_variant] ?? p.model_variant
            : '自动'
        }
      />
      <DetailRow
        label="种子"
        value={seedFixed ? (p.seed === 0 ? '随机' : String(p.seed)) : ''}
      />
      <DetailRow
        label="Sage"
        value={p.sage ? (p.sage === '关闭' ? '关闭' : `开启（${p.sage}）`) : ''}
      />
      <DetailRow
        label="Block Swap"
        value={p.blocks_to_swap !== undefined ? String(p.blocks_to_swap) : ''}
      />
      <DetailRow
        label="二采精修"
        value={
          p.second_pass
            ? `开启（×${p.second_scale ?? 1.5}，强度 ${p.second_denoise ?? 0.3}）`
            : '关闭'
        }
      />
      <DetailRow label="Unet 模型" value={p.unet} />
      <DetailRow label="LoRA" value={p.lora} />
      <DetailRow label="文本编码器" value={p.clip} />
      <DetailRow label="视频 VAE" value={p.vae_video} />
      <DetailRow label="音频 VAE" value={p.vae_audio} />

      <div className="mt-3">
        <div className="mb-1.5 text-xs text-dim/80">提示词</div>
        <div className="whitespace-pre-wrap rounded-2xl border border-line bg-soft/60 px-3 py-2 text-xs leading-relaxed text-ink">
          {job.prompt || '（无）'}
        </div>
      </div>
    </div>
  )
}

export function HistoryPage() {
  const { data: jobs, isLoading, isError, error, refetch, isFetching } = useJobs(5000)
  const cancelJob = useCancelJob()
  const createJob = useCreateJob()
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()
  const deleteProject = useDeleteProject()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)
  const [detailTarget, setDetailTarget] = useState<Job | null>(null)
  const [groupTarget, setGroupTarget] = useState<Job | null>(null)
  const [groupName, setGroupName] = useState('')
  const [renameFrom, setRenameFrom] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState<string>(ALL)

  const imageOrder = useUI((s) => s.imageOrder)
  const audioIds = useUI((s) => s.audioIds)
  const setView = useUI((s) => s.setView)

  const all = useMemo(() => jobs ?? [], [jobs])
  const projects = useMemo(
    () => Array.from(new Set(all.map((j) => j.project || '').filter(Boolean))).sort(),
    [all],
  )
  const filtered = useMemo(() => {
    if (projectFilter === ALL) return all
    if (projectFilter === NONE) return all.filter((j) => !j.project)
    return all.filter((j) => j.project === projectFilter)
  }, [all, projectFilter])

  const total = filtered.length

  function isRunning(job: Job) {
    return job.state === 'running' || job.state === 'queued'
  }

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
    const inp = job.inputs || {}
    ui.loadDraft({
      prompt: meta?.prompt ?? job.prompt ?? '',
      imageOrder: (inp.images?.length ? inp.images : meta?.images) ?? [],
      audioIds: (inp.audios?.length ? inp.audios : meta?.audios) ?? [],
      firstFrame: inp.firstFrame ?? meta?.firstFrame ?? null,
      lastFrame: inp.lastFrame ?? meta?.lastFrame ?? null,
    })
    if (meta) {
      ui.setPendingForm(meta.form)
    } else {
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

  function startEdit(job: Job) {
    setEditingId(job.id)
    setEditName(job.name)
  }

  async function commitEdit(job: Job) {
    const name = editName.trim()
    setEditingId(null)
    if (!name || name === job.name) return
    try {
      await updateJob.mutateAsync({ id: job.id, body: { name } })
      toast.success('已重命名')
    } catch (e) {
      toast.error(`重命名失败：${(e as Error).message}`)
    }
  }

  async function setGroup(job: Job, project: string) {
    if (project === NEW_GROUP) {
      setGroupName('')
      setGroupTarget(job)
      return
    }
    if (project === (job.project || '')) return
    try {
      await updateJob.mutateAsync({ id: job.id, body: { project } })
      toast.success(project ? `已归入「${project}」` : '已移出分组')
    } catch (e) {
      toast.error(`分组失败：${(e as Error).message}`)
    }
  }

  async function confirmNewGroup() {
    const name = groupName.trim()
    const job = groupTarget
    setGroupTarget(null)
    if (!name || !job) return
    try {
      await updateJob.mutateAsync({ id: job.id, body: { project: name } })
      setProjectFilter(name)
      toast.success(`已创建并归入「${name}」`)
    } catch (e) {
      toast.error(`分组失败：${(e as Error).message}`)
    }
  }

  async function confirmRenameGroup() {
    const from = renameFrom
    const to = renameTo.trim()
    setRenameFrom(null)
    if (!from || !to || to === from) return
    const affected = all.filter((j) => (j.project || '') === from)
    if (affected.length === 0) return
    try {
      await Promise.all(
        affected.map((j) =>
          updateJob.mutateAsync({ id: j.id, body: { project: to } }),
        ),
      )
      setProjectFilter(to)
      toast.success(`分组已重命名为「${to}」`)
    } catch (e) {
      toast.error(`重命名分组失败：${(e as Error).message}`)
    }
  }

  async function doDelete(job: Job) {
    try {
      await deleteJob.mutateAsync(job.id)
      toast.success('已删除')
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`)
    }
  }

  async function doDeleteGroup(project: string) {
    try {
      const r = await deleteProject.mutateAsync(project)
      toast.success(`已删除分组「${project}」（${r.count} 条）`)
      if (projectFilter === project) setProjectFilter(ALL)
    } catch (e) {
      toast.error(`删除分组失败：${(e as Error).message}`)
    }
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

  const filters: { value: string; label: string }[] = [
    { value: NONE, label: '未分组' },
    ...projects.map((p) => ({ value: p, label: p })),
  ]

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">任务列表</h2>
        <Badge>{total} 条</Badge>
        <Button className="ml-auto" size="sm" onClick={() => void refetch()}>
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> 刷新
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Folder size={14} className="text-dim" />
          {filters.map((f) => (
            <span key={f.value} className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() =>
                  setProjectFilter(projectFilter === f.value ? ALL : f.value)
                }
                title={projectFilter === f.value ? '点击取消筛选' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition',
                  projectFilter === f.value
                    ? 'border-transparent bg-ink text-white'
                    : 'border-line bg-soft text-dim hover:text-ink',
                )}
              >
                {f.label}
              </button>
              {f.value !== NONE && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameTo(f.value)
                      setRenameFrom(f.value)
                    }}
                    title="重命名分组"
                    className="grid h-6 w-6 place-items-center rounded-full text-dim/60 transition hover:bg-soft hover:text-ink"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteGroupTarget(f.value)}
                    title="删除分组（连同组内全部任务与成片）"
                    className="grid h-6 w-6 place-items-center rounded-full text-dim/60 transition hover:bg-err/10 hover:text-err"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {total === 0 && (
        <Card className="flex items-center gap-2 text-dim">
          <Clock size={15} /> 暂无生成记录。
        </Card>
      )}

      {total > 0 && (
        <>
          <div className="flex max-h-[calc(100vh-300px)] flex-col gap-4 overflow-y-auto pr-1">
            {filtered.map((job) => {
              const p = job.params || {}
              const running = isRunning(job)
              return (
                <Card
                  key={job.id}
                  className="relative flex flex-col gap-3 focus-within:z-30"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={stateTone[job.state]}>{stateText[job.state]}</Badge>

                    {editingId === job.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => void commitEdit(job)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitEdit(job)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="w-40 rounded-lg border border-line bg-canvas px-2 py-1 text-sm font-semibold outline-none focus:border-acc"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(job)}
                        title="点击重命名"
                        className="group/name inline-flex items-center gap-1 font-semibold"
                      >
                        {job.name}
                        <Pencil
                          size={12}
                          className="text-dim/0 transition group-hover/name:text-dim"
                        />
                      </button>
                    )}

                    {job.project && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-soft px-2 py-0.5 text-[11px] text-dim">
                        <Folder size={11} /> {job.project}
                      </span>
                    )}

                    <span className="text-xs text-dim">
                      {p.duration ? `${p.duration}s` : ''} {p.aspect || ''}{' '}
                      {p.resolution ? `${p.resolution}MP` : ''}
                    </span>
                    <span className="text-xs text-dim/70">
                      {formatTime(job.createdAt)}
                    </span>

                    <div className="ml-auto flex items-center gap-1.5">
                      <Select
                        icon={<Folder size={12} />}
                        value={job.project || ''}
                        options={[
                          { value: '', label: '未分组' },
                          ...projects
                            .filter((x) => x !== job.project)
                            .map((x) => ({ value: x, label: x })),
                          { value: NEW_GROUP, label: '＋ 新建分组' },
                        ]}
                        onChange={(v) => void setGroup(job, v)}
                      />
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
                        title="把提示词与素材载入生成台重新编辑"
                      >
                        <Play size={13} /> 重新编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetailTarget(job)}
                        title="查看本次生成的参数"
                      >
                        <Info size={13} /> 详情
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
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleteTarget(job)}
                        disabled={running}
                        title={running ? '任务进行中，无法删除' : '删除任务'}
                      >
                        <Trash2 size={13} />
                      </Button>
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
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除任务"
        message={`确定删除「${deleteTarget?.name ?? ''}」吗？成片文件也会一并删除，无法恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleteTarget) void doDelete(deleteTarget)
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteGroupTarget}
        title="删除分组"
        message={`确定删除分组「${deleteGroupTarget ?? ''}」吗？该分组下的所有任务与成片都会被一并删除，且无法恢复。`}
        confirmText="删除分组"
        danger
        onConfirm={() => {
          if (deleteGroupTarget) void doDeleteGroup(deleteGroupTarget)
        }}
        onCancel={() => setDeleteGroupTarget(null)}
      />

      <Modal
        open={!!groupTarget}
        onClose={() => setGroupTarget(null)}
        title="新建分组"
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void confirmNewGroup()}>
              确定
            </Button>
          </>
        }
      >
        <input
          autoFocus
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirmNewGroup()
          }}
          placeholder="分组名称，例如：项目A / 广告片"
          className="input"
        />
      </Modal>

      <Modal
        open={!!renameFrom}
        onClose={() => setRenameFrom(null)}
        title="重命名分组"
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameFrom(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void confirmRenameGroup()}>
              确定
            </Button>
          </>
        }
      >
        <input
          autoFocus
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirmRenameGroup()
          }}
          placeholder="新的分组名称"
          className="input"
        />
      </Modal>

      <Modal
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={`「${detailTarget?.name ?? ''}」生成详情`}
        width={560}
      >
        {detailTarget && jobDetail(detailTarget)}
      </Modal>
    </div>
  )
}
