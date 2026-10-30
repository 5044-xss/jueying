import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Folder,
  Gauge,
  ImagePlus,
  Layers,
  Music,
  Play,
  Plus,
  Proportions,
  Sparkles,
  Square,
  Timer,
  X,
} from 'lucide-react'
import type { Aspect, MediaRef, Project, Shot } from '@/core/types'
import { newId } from '@/core/id'
import { ComfyClient } from '@/core/comfy'
import { cancelShotJob, runShotJob } from '@/core/generate'
import { elapsedText, isActiveShot, STATE_CLASS, STATE_LABEL } from '@/lib/jobs'
import { readMedia } from '@/lib/media'
import { useNow } from '@/lib/useNow'
import { activeEndpoint, useApp } from '@/store/app'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { CaseShowcase } from '@/components/CaseShowcase'
import { ImagePickerDialog } from '@/components/ImagePickerDialog'
import { Select } from '@/ui/Select'
import { PageHeader } from '@/ui/PageHeader'
import { ShotPreviewModal } from '@/components/ShotPreviewModal'
import { JobProgress } from '@/ui/JobProgress'
import { DURATIONS, RESOLUTIONS, friendlyP, resolutionLabel } from '@/lib/resolution'
import { timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'

const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1', '4:3', '3:4']

const DRAFT_KEY = 'jueying.draft.prompt'

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

type Mode = 'reference' | 'frames'

const MODES: { value: Mode; label: string }[] = [
  { value: 'reference', label: '参考图' },
  { value: 'frames', label: '首尾帧' },
]

// 提示词输入框：两层共用同一套内联文本度量，保证逐像素对齐。
// textarea 正常显示文字（光标/选中/复制可靠）；镜像层文字透明、只画 @图片N 底色。
const PROMPT_TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '1rem',
  lineHeight: 1.625,
  letterSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  padding: '4px',
  margin: 0,
  border: 0,
  boxSizing: 'border-box',
}

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
      <span key={m.index} className="rounded-[3px] bg-lime">
        {m[1]}
      </span>,
    )
    last = m.index + m[1].length
  }
  if (last < text.length) parts.push(text.slice(last))
  if (parts.length === 0) parts.push('')
  return parts
}

export function GeneratePage() {
  const projects = useApp((s) => s.data.projects)
  const genProjectId = useApp((s) => s.genProjectId)
  const setGenProject = useApp((s) => s.setGenProject)
  const endpoint = useApp(activeEndpoint)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const ensureDefaultProject = useApp((s) => s.ensureDefaultProject)
  const addShot = useApp((s) => s.addShot)
  const updateProject = useApp((s) => s.updateProject)
  const updateShot = useApp((s) => s.updateShot)
  const editingShot = useApp((s) => s.editingShot)
  const clearEditingShot = useApp((s) => s.clearEditingShot)
  const toast = useApp((s) => s.toast)

  const target = projects.find((p) => p.id === genProjectId) ?? projects[0]
  const hasActive = (target?.shots ?? []).some(isActiveShot)
  const now = useNow(hasActive)

  const [creating, setCreating] = useState(false)
  const [picker, setPicker] = useState<'reference' | 'first' | 'last' | null>(null)
  const [playing, setPlaying] = useState<Shot | null>(null)
  const [prompt, setPrompt] = useState(readDraft)
  const [mode, setMode] = useState<Mode>('reference')
  const [imageOrder, setImageOrder] = useState<MediaRef[]>([])
  const [audios, setAudios] = useState<MediaRef[]>([])
  const [first, setFirst] = useState<MediaRef | null>(null)
  const [last, setLast] = useState<MediaRef | null>(null)
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [duration, setDuration] = useState(8)
  const [resolution, setResolution] = useState('0.5')

  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  )
  const [mentionIdx, setMentionIdx] = useState(0)
  const [preview, setPreview] = useState<{
    url: string
    label: string
    x: number
    y: number
  } | null>(null)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const audRef = useRef<HTMLInputElement>(null)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, prompt)
    } catch {
      // 忽略存储失败
    }
  }, [prompt])

  // 先应用项目默认参数，再载入待编辑视频的参数，避免默认值覆盖视频自己的参数。
  useEffect(() => {
    if (!target) return
    setAspect(target.defaultParams.aspect)
    setDuration(target.defaultParams.duration)
    setResolution(
      RESOLUTIONS.includes(target.defaultParams.resolution)
        ? target.defaultParams.resolution
        : '0.5',
    )
  }, [target?.id])

  useEffect(() => {
    if (!editingShot) return
    const state = useApp.getState()
    const project = state.data.projects.find((p) => p.id === editingShot.projectId)
    const shot = project?.shots.find((s) => s.id === editingShot.shotId)
    if (shot) {
      setPrompt(shot.prompt)
      setImageOrder(shot.images)
      setAudios(shot.audios ?? [])
      setFirst(shot.firstFrame ?? null)
      setLast(shot.lastFrame ?? null)
      setAspect(shot.params.aspect)
      setDuration(shot.params.duration)
      setResolution(shot.params.resolution)
      setMode(shot.images.length || (!shot.firstFrame && !shot.lastFrame) ? 'reference' : 'frames')
      toast('已载入到工作台')
    }
    clearEditingShot()
  }, [editingShot, clearEditingShot, toast])

  // 768P 及以上时 13–15s 长片会崩：自动夹取到 12s，并禁用这些时长。
  const highRes = friendlyP(resolution, aspect) >= 768
  useEffect(() => {
    if (highRes && duration >= 13) setDuration(12)
  }, [highRes, duration])

  // 文本框高度：3~7 行自适应
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 26
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const min = lh * 3 + pad
    const max = lh * 7 + pad
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [prompt])

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

  const mentionMatches = useMemo(() => {
    const items = imageOrder.map((r, i) => ({ ...r, n: i + 1 }))
    if (!mention) return []
    const q = mention.query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) => `图片${it.n}`.includes(q) || String(it.n) === q || it.name.toLowerCase().includes(q),
    )
  }, [mention, imageOrder])

  const mentionOpen = Boolean(mention) && mentionMatches.length > 0

  const moveImage = (from: number, to: number) => {
    setImageOrder((prev) => {
      const next = prev.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const addAudio = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('audio/'))
    if (!list.length) return
    const media = await Promise.all(list.map(readMedia))
    setAudios((prev) => [...prev, ...media])
    toast(`已添加 ${media.length} 个音频`)
  }

  const pickImages = (media: MediaRef[]) => {
    if (!picker) return
    if (picker === 'first') {
      if (media[0]) {
        setFirst(media[0])
        toast('已设置首帧')
      }
    } else if (picker === 'last') {
      if (media[0]) {
        setLast(media[0])
        toast('已设置尾帧')
      }
    } else {
      setImageOrder((prev) => [...prev, ...media])
      toast(`已添加 ${media.length} 张素材`)
    }
    setPicker(null)
  }

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

  const send = () => {
    const text = prompt.trim()
    if (!text) {
      toast('请先填写提示词', 'err')
      return
    }
    const project: Project = target ?? ensureDefaultProject()
    if (!endpoint) {
      setSettingsOpen(true)
      toast('先连接生成端', 'err')
      return
    }

    const now = Date.now()
    const shot: Shot = {
      id: newId('shot'),
      projectId: project.id,
      name: text.replace(/\s+/g, ' ').slice(0, 24),
      prompt: text,
      params: { aspect, duration, resolution, seed: null, steps: 8, blocks: 50 },
      state: 'queued',
      endpointId: endpoint.id,
      images: mode === 'reference' ? imageOrder : [],
      audios,
      firstFrame: mode === 'frames' ? first : null,
      lastFrame: mode === 'frames' ? last : null,
      createdAt: now,
    }

    updateProject(project.id, { defaultParams: { aspect, duration, resolution } })
    addShot(project.id, shot)
    toast(`已提交到「${project.name}」`)

    void runShotJob({
      client: new ComfyClient(endpoint.url, endpoint.token),
      endpointId: endpoint.id,
      shot,
      images: mode === 'reference' ? imageOrder : [],
      audios,
      firstFrame: mode === 'frames' ? first : null,
      lastFrame: mode === 'frames' ? last : null,
      update: (patch) => updateShot(project.id, shot.id, patch),
      toast,
    })
  }

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
    <div className="flex min-h-0 flex-col gap-4 md:h-full">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Studio"
          accent="mint"
          title="生成台"
          description="上传参考素材，输入文字，自由组合图、文元素。输入 @ 可引用参考图。"
        />
      </div>

      <div className="relative shrink-0 overflow-hidden rounded-[28px] bg-lime">
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/55">
              MiniMax H3 · AI Video
            </p>
            <h2 className="mt-1.5 text-xl font-light tracking-[-0.3px] text-ink sm:text-2xl">
              MiniMax H3 强力驱动
            </h2>
            <p className="mt-1 text-[11px] text-ink/60">
              原生带音频 · 参考图 / 首尾帧 / 音频多模态
            </p>
          </div>
          <div className="inline-flex items-baseline gap-1 rounded-full bg-ink px-4 py-2 text-canvas">
            <span className="text-[10px] text-canvas/65">最低至</span>
            <span className="text-lg font-semibold tracking-tight">¥0.008</span>
            <span className="text-[10px] text-canvas/65">/秒</span>
          </div>
        </div>
      </div>

      <RecentShot project={target} now={now} onPlay={setPlaying} />

      <div className="relative z-20 shrink-0 rounded-[24px] border border-line bg-canvas p-4 transition-colors focus-within:ring-1 focus-within:ring-ink/20 sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {projects.length > 0 ? (
              <Select
                icon={<Folder size={13} />}
                value={target?.id ?? ''}
                onChange={(v) => setGenProject(v)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="选择项目"
              />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-dim">
                <Folder size={13} />
                未命名项目
              </span>
            )}
            <button
              className="btn ml-auto px-3.5 py-1.5 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} />
              新项目
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {mode === 'reference' ? (
              <>
                {imageOrder.map((m, i) => (
                  <div
                    key={m.id}
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
                    onMouseEnter={openPreview(m.url ?? '', m.name)}
                    onMouseMove={movePreview}
                    onMouseLeave={closePreview}
                    className="group relative h-16 w-16 cursor-grab overflow-hidden rounded-lg border border-line bg-soft"
                  >
                    <div className="absolute inset-0 grid place-items-center text-dim/40">
                      <ImagePlus size={16} />
                    </div>
                    <img
                      src={m.url}
                      alt={m.name}
                      onClick={() => insertMention(i + 1, prompt.length, prompt.length)}
                      title="点击插入 @图片N"
                      className="relative h-full w-full cursor-pointer object-contain"
                    />
                    <span className="absolute bottom-1 left-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 font-mono text-[10px] font-bold text-canvas">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setImageOrder((prev) => prev.filter((x) => x.id !== m.id))
                        setPreview(null)
                      }}
                      title="移除"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-canvas opacity-0 transition hover:bg-err group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPicker('reference')}
                  title="上传参考图"
                  className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-dim transition hover:border-ink/40 hover:bg-soft hover:text-ink"
                >
                  <Plus size={18} />
                </button>
              </>
            ) : (
              <>
                <FrameSlot
                  label="首帧"
                  media={first}
                  onPick={() => setPicker('first')}
                  onClear={() => {
                    setFirst(null)
                    closePreview()
                  }}
                  preview={previewHandlers}
                />
                <FrameSlot
                  label="尾帧"
                  media={last}
                  onPick={() => setPicker('last')}
                  onClear={() => {
                    setLast(null)
                    closePreview()
                  }}
                  preview={previewHandlers}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => audRef.current?.click()}
              title="上传参考音频"
              className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-dim transition hover:border-ink/40 hover:bg-soft hover:text-ink"
            >
              <Music size={16} />
            </button>
          </div>

          {audios.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {audios.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-soft px-2.5 py-1 text-xs text-dim"
                >
                  <Music size={12} className="shrink-0 text-ink" />
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAudios((prev) => prev.filter((x) => x.id !== a.id))}
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
              style={PROMPT_TEXT_STYLE}
              className="pointer-events-none absolute inset-0 overflow-hidden text-transparent"
            >
              {renderHighlight(prompt)}
            </div>
            <textarea
              ref={taRef}
              rows={2}
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
                    setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
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
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="上传参考素材、输入文字，自由组合图、文元素。输入 @ 引用参考图，例如：@图片1 抬手把书递给她…"
              style={PROMPT_TEXT_STYLE}
              className="no-scrollbar relative block w-full resize-none bg-transparent text-ink caret-ink outline-none placeholder:text-dim/60"
            />

            {mentionOpen && (
              <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-line bg-canvas p-2 shadow-lift">
                <div className="mb-1 px-1 font-mono text-[10px] uppercase tracking-wider text-dim">
                  引用参考图（{mentionMatches.length}）
                </div>
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
                  {mentionMatches.map((it, idx) => (
                    <button
                      key={it.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => mention && insertMention(it.n, mention.start, mention.end)}
                      onMouseEnter={(e) => {
                        setMentionIdx(idx)
                        setPreview({ url: it.url ?? '', label: it.name, x: e.clientX, y: e.clientY })
                      }}
                      onMouseMove={movePreview}
                      onMouseLeave={closePreview}
                      title={it.name}
                      className={cn(
                        'relative aspect-square overflow-hidden rounded-lg border transition',
                        idx === mentionIdx ? 'border-ink' : 'border-line',
                      )}
                    >
                      <img src={it.url} alt={it.name} className="h-full w-full object-contain" />
                      <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center font-mono text-[10px] text-canvas">
                        图片{it.n}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select
              icon={<Layers size={13} />}
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={MODES.map((m) => ({ value: m.value, label: m.label }))}
            />
            <Select
              icon={<Proportions size={13} />}
              value={aspect}
              onChange={(v) => setAspect(v as Aspect)}
              options={ASPECTS.map((a) => ({ value: a, label: a }))}
            />
            <Select
              icon={<Timer size={13} />}
              value={String(duration)}
              onChange={(v) => setDuration(Number(v))}
              options={DURATIONS.map((n) => ({
                value: String(n),
                label: `${n}s`,
                disabled: highRes && n >= 13,
              }))}
            />
            <Select
              icon={<Gauge size={13} />}
              value={resolution}
              onChange={setResolution}
              options={RESOLUTIONS.map((r) => ({
                value: r,
                label: resolutionLabel(r, aspect),
              }))}
            />

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={send}
                title="生成视频"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium text-canvas transition hover:bg-black/85"
              >
                生成
                <ArrowUp size={15} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>

        <input
          ref={audRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addAudio(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div className="shrink-0 md:min-h-0 md:flex-1">
        <CaseShowcase limit={4} />
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}

      {picker && (
        <ImagePickerDialog
          projectId={target?.id}
          single={picker !== 'reference'}
          onClose={() => setPicker(null)}
          onPick={pickImages}
        />
      )}

      {playing && (
        <ShotPreviewModal shot={playing} onClose={() => setPlaying(null)} />
      )}

      {preview && previewStyle && (
        <div className="pointer-events-none fixed z-[80]" style={previewStyle}>
          <img
            src={preview.url}
            alt={preview.label}
            className="max-h-56 w-auto max-w-xs rounded-lg border border-line bg-canvas object-contain shadow-lift"
          />
        </div>
      )}
    </div>
  )
}

function RecentShot({
  project,
  now,
  onPlay,
}: {
  project?: Project
  now: number
  onPlay: (shot: Shot) => void
}) {
  const endpoint = useApp(activeEndpoint)
  const endpoints = useApp((s) => s.data.endpoints)
  const updateShot = useApp((s) => s.updateShot)
  const toast = useApp((s) => s.toast)

  if (!project || project.shots.length === 0) return null

  const shot = project.shots[project.shots.length - 1]
  const active = isActiveShot(shot)

  const cancel = () => {
    const target = endpoints.find((e) => e.id === shot.endpointId) ?? endpoint
    if (!target) {
      toast('找不到生成端，无法取消', 'err')
      return
    }
    void cancelShotJob({
      client: new ComfyClient(target.url, target.token),
      shot,
      update: (patch) => updateShot(project.id, shot.id, patch),
      toast,
    })
  }

  return (
    <article className="flex shrink-0 items-center gap-4 rounded-[24px] border border-line bg-canvas px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-soft text-ink">
        <Sparkles size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/55">
            最近生成
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${STATE_CLASS[shot.state]}`}
          >
            {STATE_LABEL[shot.state]}
          </span>
          <span className="font-mono text-[10px] text-ink/50">
            {active
              ? elapsedText(shot.createdAt, now)
              : timeAgo(shot.finishedAt ?? shot.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium">{shot.name}</p>
        <p className="mt-0.5 font-mono text-[10px] text-ink/55">
          {project.name} · {shot.params.aspect} · {shot.params.duration}s
          {active && typeof shot.progress === 'number' ? ` · ${shot.progress}%` : ''}
        </p>
        {active && (
          <JobProgress
            state={shot.state}
            progress={shot.progress}
            className="mt-1.5 max-w-md"
          />
        )}
      </div>
      {active ? (
        <button
          type="button"
          onClick={cancel}
          title="取消生成"
          aria-label="取消生成"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-err/30 bg-err/5 px-4 text-xs font-medium text-err transition hover:bg-err/10"
        >
          <Square size={13} />
          取消
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onPlay(shot)}
          disabled={!shot.output}
          title="播放"
          aria-label="播放"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-canvas transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={16} className="translate-x-[1px]" />
        </button>
      )}
    </article>
  )
}

function FrameSlot({
  label,
  media,
  onPick,
  onClear,
  preview,
}: {
  label: string
  media: MediaRef | null
  onPick: () => void
  onClear: () => void
  preview: (url: string, label: string) => HoverHandlers
}) {
  if (media) {
    return (
      <div
        className="group relative h-16 w-28 overflow-hidden rounded-lg border border-line bg-soft"
        {...preview(media.url ?? '', label)}
      >
        <img src={media.url} alt={label} className="h-full w-full object-contain" />
        <span className="absolute bottom-1 left-1 rounded-full bg-canvas/90 px-1.5 py-0.5 font-mono text-[10px] text-ink">
          {label}
        </span>
        <button
          type="button"
          onClick={onClear}
          title="移除"
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-canvas opacity-0 transition hover:bg-err group-hover:opacity-100"
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
      className="grid h-16 w-28 place-items-center gap-0.5 rounded-lg border border-dashed border-line text-dim transition hover:border-ink/40 hover:bg-soft hover:text-ink"
    >
      <Plus size={16} />
      <span className="text-[11px]">{label}</span>
    </button>
  )
}
