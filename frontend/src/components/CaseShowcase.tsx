import { Copy, Play } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { useDuplicateProject, useJobs } from '../api/queries'
import type { Job } from '../api/types'
import { CASES, type CaseItem } from '../cases/showcase'
import { toast } from '../store/toast'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { Spinner } from './ui/Spinner'

function CaseCard({
  name,
  src,
  onOpen,
}: {
  name: string
  src: string
  onOpen: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => void ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = ref.current
        if (!v) return
        v.pause()
        v.currentTime = 0
      }}
      className="group relative aspect-video w-full overflow-hidden rounded-2xl border border-line/70 bg-black shadow-card transition hover:shadow-lift"
    >
      {src ? (
        <video
          ref={ref}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-xs text-dim">
          暂无成片
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/85 text-ink opacity-0 shadow-lift backdrop-blur transition group-hover:opacity-100">
          <Play size={16} className="translate-x-[1px]" />
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 truncate px-2.5 py-2 text-left text-xs font-medium text-white drop-shadow">
        {name}
      </span>
    </button>
  )
}

export function CaseShowcase() {
  const { data: jobs } = useJobs(15000)
  const dup = useDuplicateProject()
  const [active, setActive] = useState<CaseItem | null>(null)
  const [busy, setBusy] = useState(false)

  // 各分组最新的一条成功成片（source = 'latest' 的案例用它）
  const latestByProject = useMemo(() => {
    const map: Record<string, Job> = {}
    for (const j of jobs ?? []) {
      if (j.state !== 'success' || !j.videoUrl) continue
      const p = j.project || ''
      if (!map[p] || (j.createdAt ?? 0) > (map[p].createdAt ?? 0)) map[p] = j
    }
    return map
  }, [jobs])

  function srcFor(c: CaseItem) {
    if (c.source === 'case') return api.caseVideo(c.name)
    const j = latestByProject[c.name]
    return j ? api.videoUrl(j.id) : ''
  }

  async function onCopy() {
    if (!active) return
    setBusy(true)
    try {
      const r = await dup.mutateAsync({ source: active.name })
      toast.success(`已复制到记录 · 分组「${r.project}」（${r.count} 条）`)
      setActive(null)
    } catch (e) {
      toast.error(`复制失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (CASES.length === 0) return null
  const activeSrc = active ? srcFor(active) : ''

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">案例展示</h2>
        <span className="text-xs text-dim">悬停预览 · 点击播放</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CASES.map((c) => (
          <CaseCard
            key={c.name}
            name={c.name}
            src={srcFor(c)}
            onOpen={() => setActive(c)}
          />
        ))}
      </div>

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.name ?? ''}
        width={760}
        footer={
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void onCopy()}
          >
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <Copy size={13} />} 复制项目
          </Button>
        }
      >
        {active &&
          (activeSrc ? (
            <div className="flex h-[clamp(240px,56vh,520px)] items-center justify-center overflow-hidden rounded-2xl bg-black">
              <video
                key={activeSrc}
                src={activeSrc}
                controls
                autoPlay
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="grid h-48 place-items-center rounded-2xl border border-dashed border-line text-sm text-dim">
              该分组暂无可展示成片
            </div>
          ))}
      </Modal>
    </section>
  )
}
