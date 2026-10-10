import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUp,
  CircleHelp,
  Gauge,
  Image as ImageIcon,
  Layers,
  Music,
  Plus,
  Proportions,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import {
  qk,
  useAssets,
  useCancelJob,
  useCreateJob,
  useHealth,
  useJobs,
  useSettings,
} from '../api/queries'
import type { Aspect, Job, JobForm } from '../api/types'
import { JobProgress } from '../components/JobProgress'
import { Select } from '../components/ui/Select'
import { Spinner } from '../components/ui/Spinner'
import { Tip } from '../components/ui/Tip'
import { useJobEvents } from '../hooks/useJobEvents'
import { saveJobMeta } from '../lib/jobMeta'
import { cn } from '../lib/utils'
import { toast } from '../store/toast'
import { useUI } from '../store/ui'

const EMPTY_FORM: JobForm = {
  title: 'clip',
  duration: 8,
  aspect: '16:9',
  resolution: '0.5',
  seed: 0,
  samplerMode: '',
  modelVariant: 'auto',
}

const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1', '4:3', '3:4']
const RESOLUTIONS = ['0.4', '0.5', '1', '1.5', '2']
const DURATIONS = Array.from({ length: 12 }, (_, i) => {
  const n = i + 4
  return { value: String(n), label: `${n}s` }
})
const MODES = [
  { value: 'reference', label: '参考图' },
  { value: 'frames', label: '首尾帧' },
]

// 与后端 engine/utils._with_resolution 保持一致，给出友好分辨率标注
const RATIOS: Record<Aspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
}
const NATIVE_DIMS: Record<string, [number, number]> = {
  '16:9|0.4': [864, 480],
  '16:9|0.5': [960, 544],
  '16:9|1': [1344, 768],
  '16:9|1.5': [1600, 896],
  '16:9|2': [1920, 1088],
  '9:16|0.4': [480, 864],
  '9:16|0.5': [544, 960],
  '9:16|1': [768, 1344],
  '9:16|1.5': [896, 1600],
  '9:16|2': [1088, 1920],
}

function resDims(res: string, aspect: Aspect): [number, number] {
  const native = NATIVE_DIMS[`${aspect}|${res}`]
  if (native) return native
  const mp = parseFloat(res) || 0.5
  const ratio = RATIOS[aspect] || 16 / 9
  const area = mp * 1_000_000
  const w = Math.max(
    256,
    Math.min(5760, Math.floor(Math.sqrt(area * ratio) / 32) * 32),
  )
  const h = Math.max(
    256,
    Math.min(5760, Math.floor(Math.sqrt(area / ratio) / 32) * 32),
  )
  return [w, h]
}

function friendlyP(res: string, aspect: Aspect): number {
  const short = Math.min(...resDims(res, aspect))
  const buckets = [360, 480, 540, 720, 900, 1080, 1440]
  return buckets.find((b) => Math.abs(b - short) / b < 0.07) ?? short
}

type Mode = 'reference' | 'frames'

type HoverHandlers = {
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseLeave: () => void
}

function renderHighlight(text: string) {
  const parts: React.ReactNode[] = []
  const re = /(@图片\d+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <span key={m.index} className="text-acc">
        {m[1]}
      </span>,
    )
    last = m.index + m[1].length
  }
  if (last < text.length) parts.push(text.slice(last))
  if (parts.length === 0) parts.push('')
  return parts
}

function MorePopover({
  form,
  onChange,
}: {
  form: JobForm
  onChange: (patch: Partial<JobForm>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition',
          open
            ? 'border-ink/25 bg-soft text-ink'
            : 'border-line bg-canvas/70 text-dim hover:border-ink/25 hover:text-ink',
        )}
      >
        <SlidersHorizontal size={13} /> 更多
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-line bg-canvas p-4 shadow-lift">
          <div className="flex flex-col gap-3">
            <div>
              <div className="label">
                <Tip text="成片文件名前缀（会写到输出目录）。">
                  任务名（文件名）
                  <CircleHelp size={12} />
                </Tip>
              </div>
              <input
                className="input"
                value={form.title}
                placeholder="clip-1"
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </div>
            <div>
              <div className="label">
                <Tip text="随机种子。0 = 每次随机；填固定数字可复现相同结果（提示词与参数一致时）。一般填 0 即可。">
                  种子（0=随机）
                  <CircleHelp size={12} />
                </Tip>
              </div>
              <input
                type="number"
                className="input"
                value={form.seed}
                onChange={(e) => onChange({ seed: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <div className="label">
                <Tip text="两套采样链路：legacy=旧版多速率采样（兼容未升级的仙宫云 ComfyUI）；new=官方新版链路（AutoDL 已升级）。「自动」按连接类型选择（仙宫云→legacy，AutoDL→new）。一般保持「自动」。">
                  采样链路
                  <CircleHelp size={12} />
                </Tip>
              </div>
              <Select
                className="block"
                value={form.samplerMode}
                options={[
                  { value: '', label: '自动（按连接类型）' },
                  { value: 'legacy', label: 'legacy（旧链路）' },
                  { value: 'new', label: 'new（新链路）' },
                ]}
                onChange={(v) => onChange({ samplerMode: v })}
              />
            </div>
            <div>
              <div className="label">
                <Tip text="参考模式：ref2va=参考图/音频转视频；fl2va=首尾帧转视频。「自动」=有音频/视频参考时用 ref2va，纯图用 fl2va。一般保持「自动」。">
                  模型路由
                  <CircleHelp size={12} />
                </Tip>
              </div>
              <Select
                className="block"
                value={form.modelVariant}
                options={[
                  { value: 'auto', label: 'auto（自动）' },
                  { value: 'fl2va', label: 'fl2va（首尾帧）' },
                  { value: 'ref2va', label: 'ref2va（参考图/音频）' },
                ]}
                onChange={(v) =>
                  onChange({ modelVariant: v as JobForm['modelVariant'] })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FrameSlot({
  label,
  id,
  busy,
  onPick,
  onClear,
  preview,
}: {
  label: string
  id: string | null
  busy: boolean
  onPick: () => void
  onClear: () => void
  preview: (url: string, label: string) => HoverHandlers
}) {
  if (id) {
    return (
      <div
        className="relative h-16 w-28 overflow-hidden rounded-2xl border border-line bg-soft"
        {...preview(api.assetUrl(id), label)}
      >
        <img src={api.assetUrl(id)} alt={label} className="h-full w-full object-cover" />
        <span className="absolute bottom-1 left-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-[10px] text-white">
          {label}
        </span>
        <button
          type="button"
          onClick={onClear}
          title="移除"
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-white transition hover:bg-err"
        >
          <X size={11} />
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onPick}
      className="grid h-16 w-28 place-items-center gap-0.5 rounded-2xl border border-dashed border-line text-dim transition hover:border-acc hover:bg-soft hover:text-acc"
    >
      {busy ? <Spinner className="h-4 w-4" /> : <Plus size={16} />}
      <span className="text-[11px]">{label}</span>
    </button>
  )
}

function FrameSlots({
  preview,
}: {
  preview: (url: string, label: string) => HoverHandlers
}) {
  const firstFrame = useUI((s) => s.firstFrame)
  const lastFrame = useUI((s) => s.lastFrame)
  const setFirstFrame = useUI((s) => s.setFirstFrame)
  const setLastFrame = useUI((s) => s.setLastFrame)
  const qc = useQueryClient()
  const firstRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'first' | 'last' | null>(null)

  async function pick(file: File | undefined, which: 'first' | 'last') {
    if (!file) return
    setBusy(which)
    try {
      const a = await api.upload(file, 'image')
      if (which === 'first') setFirstFrame(a.id)
      else setLastFrame(a.id)
      qc.invalidateQueries({ queryKey: qk.assets })
    } catch (e) {
      toast.error(`上传失败：${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <FrameSlot
        label="首帧"
        id={firstFrame}
        busy={busy === 'first'}
        onPick={() => firstRef.current?.click()}
        onClear={() => setFirstFrame(null)}
        preview={preview}
      />
      <FrameSlot
        label="尾帧"
        id={lastFrame}
        busy={busy === 'last'}
        onPick={() => lastRef.current?.click()}
        onClear={() => setLastFrame(null)}
        preview={preview}
      />
      <input
        ref={firstRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0], 'first')
          e.target.value = ''
        }}
      />
      <input
        ref={lastRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0], 'last')
          e.target.value = ''
        }}
      />
    </>
  )
}

export function GeneratorPage() {
  const { data: settings } = useSettings()
  const { data: health } = useHealth()
  const { data: jobs } = useJobs(15000)
  const createJob = useCreateJob()
  const cancelJob = useCancelJob()
  const qc = useQueryClient()
  const { data: assets } = useAssets()

  const prompt = useUI((s) => s.prompt)
  const setPrompt = useUI((s) => s.setPrompt)
  const imageOrder = useUI((s) => s.imageOrder)
  const addImage = useUI((s) => s.addImage)
  const removeImage = useUI((s) => s.removeImage)
  const moveImage = useUI((s) => s.moveImage)
  const audioIds = useUI((s) => s.audioIds)
  const addAudio = useUI((s) => s.addAudio)
  const removeAudio = useUI((s) => s.removeAudio)
  const firstFrame = useUI((s) => s.firstFrame)
  const lastFrame = useUI((s) => s.lastFrame)
  const currentJobId = useUI((s) => s.currentJobId)
  const setCurrentJobId = useUI((s) => s.setCurrentJobId)
  const pendingForm = useUI((s) => s.pendingForm)
  const setPendingForm = useUI((s) => s.setPendingForm)
  const setView = useUI((s) => s.setView)

  const [form, setForm] = useState<JobForm>(EMPTY_FORM)
  const [mode, setMode] = useState<Mode>('reference')
  const [created, setCreated] = useState<Job | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mention, setMention] = useState<{
    start: number
    end: number
    query: string
  } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [preview, setPreview] = useState<{
    url: string
    label: string
    x: number
    y: number
  } | null>(null)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const audRef = useRef<HTMLInputElement>(null)
  const dragFrom = useRef<number | null>(null)
  const inited = useRef(false)

  const openPreview = (url: string, label: string) => (e: React.MouseEvent) =>
    setPreview({ url, label, x: e.clientX, y: e.clientY })
  const movePreview = (e: React.MouseEvent) =>
    setPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))
  const closePreview = () => setPreview(null)
  const previewHandlers = (url: string, label: string): HoverHandlers => ({
    onMouseEnter: openPreview(url, label),
    onMouseMove: movePreview,
    onMouseLeave: closePreview,
  })

  useEffect(() => {
    if (!inited.current && settings) {
      inited.current = true
      setForm({
        title: 'clip',
        duration: settings.gen.duration_max || 8,
        aspect: '16:9',
        resolution: String(settings.gen.megapixels ?? 0.5),
        seed: settings.gen.seed_auto ? 0 : settings.gen.seed || 0,
        samplerMode: settings.cloud.sampler_mode || '',
        modelVariant: 'auto',
      })
    }
  }, [settings])

  // 从历史「载入」时恢复参数
  useEffect(() => {
    if (!pendingForm) return
    inited.current = true
    setForm((f) => ({ ...f, ...pendingForm }))
    setPendingForm(null)
  }, [pendingForm, setPendingForm])

  const { job, connected } = useJobEvents(currentJobId, created)

  const lastSuccess = useMemo(() => {
    const ok = (jobs ?? []).filter((j) => j.state === 'success' && j.videoUrl)
    ok.sort((a, b) => b.createdAt - a.createdAt)
    return ok[0] ?? null
  }, [jobs])

  const displayJob = job ?? lastSuccess

  const nameOf = (id: string) =>
    assets?.find((a) => a.id === id)?.name ?? id.slice(0, 6)

  const mentionMatches = useMemo(() => {
    const items = imageOrder.map((id, i) => ({ id, n: i + 1, name: nameOf(id) }))
    if (!mention) return []
    const q = mention.query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        `图片${it.n}`.includes(q) ||
        String(it.n) === q ||
        it.name.toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention, imageOrder, assets])

  // 文本框高度：3~6 行自适应
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 26
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const min = lh * 3 + pad
    const max = lh * 6 + pad
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [prompt])

  function insertMention(n: number, start: number, end: number) {
    const txt = `@图片${n} `
    const v = prompt.slice(0, start) + txt + prompt.slice(end)
    setPrompt(v)
    setMention(null)
    setPreview(null)
    const caret = start + txt.length
    requestAnimationFrame(() => {
      const t = taRef.current
      if (t) {
        t.focus()
        t.setSelectionRange(caret, caret)
      }
    })
  }

  function onPromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setPrompt(v)
    const pos = e.target.selectionStart ?? v.length
    const m = v.slice(0, pos).match(/@([^@\s]*)$/)
    if (m && imageOrder.length > 0) {
      setMention({ start: pos - m[0].length, end: pos, query: m[1] })
      setMentionIdx(0)
    } else {
      if (mention) setPreview(null)
      setMention(null)
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    let ok = 0
    for (const f of Array.from(files)) {
      try {
        const a = await api.upload(f, 'image')
        addImage(a.id)
        ok++
      } catch (e) {
        toast.error(`上传失败 ${f.name}：${(e as Error).message}`)
      }
    }
    setUploading(false)
    if (ok) {
      toast.success(`已上传 ${ok} 张图片`)
      qc.invalidateQueries({ queryKey: qk.assets })
    }
  }

  async function uploadAudio(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    let ok = 0
    for (const f of Array.from(files)) {
      try {
        const a = await api.upload(f, 'audio')
        addAudio(a.id)
        ok++
      } catch (e) {
        toast.error(`上传失败 ${f.name}：${(e as Error).message}`)
      }
    }
    setUploading(false)
    if (ok) {
      toast.success(`已上传 ${ok} 个音频`)
      qc.invalidateQueries({ queryKey: qk.assets })
    }
  }

  async function onGenerate() {
    if (!prompt.trim()) {
      toast.error('请先填写提示词')
      return
    }
    setSubmitting(true)
    try {
      const j = await createJob.mutateAsync({
        prompt,
        title: form.title || 'clip',
        duration: form.duration,
        aspect: form.aspect,
        resolution: form.resolution,
        seed: form.seed,
        images: imageOrder,
        audios: audioIds,
        firstFrame: firstFrame,
        lastFrame: lastFrame,
        samplerMode: form.samplerMode || null,
        modelVariant: form.modelVariant,
      })
      setCreated(j)
      setCurrentJobId(j.id)
      saveJobMeta(j.id, {
        prompt,
        images: imageOrder,
        audios: audioIds,
        firstFrame,
        lastFrame,
        form,
      })
      // 提交后清空输入框与素材，方便直接排下一个任务（参数保留）
      useUI.getState().loadDraft({
        prompt: '',
        imageOrder: [],
        audioIds: [],
        firstFrame: null,
        lastFrame: null,
      })
      setMention(null)
      setPreview(null)
      toast.success('已提交生成任务，可继续下一个')
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function onCancel() {
    if (!currentJobId) return
    try {
      await cancelJob.mutateAsync(currentJobId)
      toast.info('已发送取消指令')
    } catch (e) {
      toast.error(`取消失败：${(e as Error).message}`)
    }
  }

  const running = job?.state === 'running' || job?.state === 'queued'
  const mentionOpen = !!mention && mentionMatches.length > 0

  let previewStyle: { left: number; top: number } | null = null
  if (preview) {
    const W = 288
    const H = 224
    const pad = 18
    let left = preview.x + pad
    let top = preview.y + pad
    if (left + W > window.innerWidth - 8) left = preview.x - W - pad
    if (top + H > window.innerHeight - 8) top = preview.y - H - pad
    previewStyle = { left, top }
  }

  return (
    <div className="flex w-full flex-col gap-6 pb-12">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-lime via-mint to-cream p-6 shadow-soft">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-acc2">
          MiniMax H3 · AI Video
        </p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          <Sparkles size={26} className="shrink-0 text-acc2" />
          MiniMax H3 强力驱动
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-baseline gap-1.5 rounded-2xl bg-ink px-3.5 py-1.5 text-white shadow-soft">
            <span className="text-xs font-medium text-white/70">低至</span>
            <span className="text-2xl font-extrabold tracking-tight">¥0.01</span>
            <span className="text-xs font-medium text-white/70">/秒</span>
          </span>
          <span className="text-sm font-medium text-ink/75">
            原生带音频 · 参考图 / 首尾帧 / 音频多模态
          </span>
        </div>
      </div>

      {health && !health.configured && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          <TriangleAlert size={16} />
          尚未配置云端地址，请先前往
          <button
            className="font-semibold underline underline-offset-2"
            onClick={() => setView('settings')}
          >
            设置
          </button>
          填写仙宫云实例地址。
        </div>
      )}

      {/* 输入框（素材 + 参数都在里面） */}
      <div className="rounded-[28px] border border-line/70 bg-canvas/55 p-4 shadow-soft backdrop-blur-xl sm:p-5">
        <div className="flex flex-col gap-3">
          {/* 素材 */}
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'reference' ? (
              <>
                {imageOrder.map((id, i) => (
                  <div
                    key={id}
                    draggable
                    onDragStart={() => (dragFrom.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragFrom.current !== null && dragFrom.current !== i) {
                        moveImage(dragFrom.current, i)
                      }
                      dragFrom.current = null
                    }}
                    onMouseEnter={openPreview(api.assetUrl(id), nameOf(id))}
                    onMouseMove={movePreview}
                    onMouseLeave={closePreview}
                    className="group relative h-16 w-16 cursor-grab overflow-hidden rounded-2xl border border-line bg-soft"
                  >
                    <div className="absolute inset-0 grid place-items-center text-dim/40">
                      <ImageIcon size={16} />
                    </div>
                    <img
                      src={api.assetUrl(id)}
                      alt={nameOf(id)}
                      onClick={() => insertMention(i + 1, prompt.length, prompt.length)}
                      title="点击插入 @图片N"
                      className="relative h-full w-full cursor-pointer object-cover"
                      onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                    />
                    <span className="absolute bottom-1 left-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeImage(id)}
                      title="移除"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-white transition hover:bg-err"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="上传参考图"
                  className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-line text-dim transition hover:border-acc hover:bg-soft hover:text-acc"
                >
                  {uploading ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Plus size={18} />
                  )}
                </button>
              </>
            ) : (
              <FrameSlots preview={previewHandlers} />
            )}

            <button
              type="button"
              onClick={() => audRef.current?.click()}
              title="上传参考音频"
              className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-line text-dim transition hover:border-acc hover:bg-soft hover:text-acc"
            >
              <Music size={16} />
            </button>
          </div>

          {audioIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {audioIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-soft px-2.5 py-1 text-xs text-dim"
                >
                  <Music size={12} className="shrink-0 text-acc" />
                  <span className="truncate">{nameOf(id)}</span>
                  <button
                    type="button"
                    onClick={() => removeAudio(id)}
                    className="shrink-0 transition hover:text-err"
                    title="移除"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 提示词 + @ 引用 */}
          <div className="relative">
            <div
              ref={backdropRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-1 text-base leading-relaxed text-ink"
            >
              {renderHighlight(prompt)}
            </div>
            <textarea
              ref={taRef}
              rows={3}
              value={prompt}
              onChange={onPromptChange}
              onScroll={(e) => {
                if (backdropRef.current) {
                  backdropRef.current.scrollTop = e.currentTarget.scrollTop
                }
              }}
              onKeyDown={(e) => {
                if (mentionOpen) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIdx((i) => (i + 1) % mentionMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIdx(
                      (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
                    )
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const it = mentionMatches[mentionIdx]
                    if (it && mention) insertMention(it.n, mention.start, mention.end)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setMention(null)
                    setPreview(null)
                    return
                  }
                }
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  if (!submitting && !running) void onGenerate()
                }
              }}
              placeholder="上传参考素材、输入文字，自由组合图、文元素。输入 @ 引用参考图，例如：@图片1 抬手把书递给她…"
              className="no-scrollbar relative w-full resize-none border-0 bg-transparent px-1 py-1 text-base leading-relaxed text-transparent caret-ink outline-none placeholder:text-dim/60"
            />

            {mentionOpen && (
              <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-2xl border border-line bg-canvas p-2 shadow-lift">
                <div className="mb-1 px-1 text-[11px] text-dim/70">
                  引用参考图（{mentionMatches.length}）
                </div>
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
                  {mentionMatches.map((it, idx) => (
                    <button
                      key={it.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        mention && insertMention(it.n, mention.start, mention.end)
                      }
                      onMouseEnter={(e) => {
                        setMentionIdx(idx)
                        setPreview({
                          url: api.assetUrl(it.id),
                          label: it.name,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }}
                      onMouseMove={movePreview}
                      onMouseLeave={closePreview}
                      title={it.name}
                      className={cn(
                        'relative aspect-square overflow-hidden rounded-xl border transition',
                        idx === mentionIdx ? 'border-acc' : 'border-line',
                      )}
                    >
                      <img
                        src={api.assetUrl(it.id)}
                        alt={it.name}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-ink/60 py-0.5 text-center text-[10px] text-white">
                        图片{it.n}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
            <Select
              icon={<Layers size={13} />}
              value={mode}
              options={MODES}
              onChange={(v) => setMode(v as Mode)}
            />
            <Select
              icon={<Proportions size={13} />}
              value={form.aspect}
              options={ASPECTS.map((a) => ({ value: a, label: a }))}
              onChange={(v) => setForm((f) => ({ ...f, aspect: v as Aspect }))}
            />
            <Select
              icon={<Timer size={13} />}
              value={String(form.duration)}
              options={DURATIONS}
              onChange={(v) => setForm((f) => ({ ...f, duration: Number(v) }))}
            />
            <Tip text="输出分辨率档位；括号内是约等于的短边像素（p），会随画幅变化。">
              <Select
                icon={<Gauge size={13} />}
                value={form.resolution}
                options={RESOLUTIONS.map((r) => ({
                  value: r,
                  label: `${r}MP · ${friendlyP(r, form.aspect)}p`,
                }))}
                onChange={(v) => setForm((f) => ({ ...f, resolution: v }))}
              />
            </Tip>
            <MorePopover
              form={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onGenerate}
                disabled={submitting}
                title="生成视频"
                className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white shadow-soft transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <ArrowUp size={18} />
                )}
              </button>
            </div>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void uploadImages(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={audRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void uploadAudio(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* 结果 */}
      {displayJob && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="section-title">{job ? '结果' : '上一张成片'}</span>
            <button
              type="button"
              onClick={() => setView('history')}
              className="ml-auto text-xs text-dim underline underline-offset-2 transition hover:text-ink"
            >
              在历史中查看
            </button>
          </div>
          <div className="rounded-3xl border border-line/70 bg-canvas/55 p-5 shadow-card backdrop-blur-xl">
            <JobProgress
              job={displayJob}
              connected={displayJob === job ? connected : false}
              onCancel={displayJob === job && running ? onCancel : undefined}
              cancelling={cancelJob.isPending}
            />
          </div>
        </section>
      )}

      {preview && previewStyle && (
        <div className="pointer-events-none fixed z-[80]" style={previewStyle}>
          <img
            src={preview.url}
            alt={preview.label}
            className="max-h-56 w-auto max-w-xs rounded-2xl border border-line bg-canvas object-contain shadow-lift"
          />
        </div>
      )}
    </div>
  )
}
