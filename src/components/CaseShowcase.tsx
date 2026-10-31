import { useRef, useState } from 'react'
import { CloudDownload, Copy, Play, Trash2, Upload } from 'lucide-react'
import { caseToProject, packToCase } from '@/core/manifest'
import type { CasePack } from '@/core/types'
import { readPackFile } from '@/lib/projectFile'
import { coverStyle } from '@/lib/cover'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'

function firstVideo(pack: CasePack): string | null {
  return pack.shots.find((shot) => shot.video)?.video ?? null
}

function CaseCard({
  pack,
  onOpen,
  onDelete,
}: {
  pack: CasePack
  onOpen: () => void
  onDelete: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const video = firstVideo(pack)

  const play = () => {
    const node = videoRef.current
    if (!node) return
    node.currentTime = 0
    void node.play().catch(() => {})
  }

  const stop = () => {
    const node = videoRef.current
    if (!node) return
    node.pause()
    node.currentTime = 0
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      className="group relative mx-auto aspect-video w-full max-w-[280px] cursor-pointer overflow-hidden rounded-lg border border-line bg-soft text-left transition hover:border-ink/20 sm:mx-0 sm:max-w-none"
      style={video ? undefined : coverStyle(pack.id)}
    >
      {video && (
        <video
          ref={videoRef}
          src={video}
          muted
          loop
          playsInline
          preload="auto"
          className="pointer-events-none size-full object-cover"
          onLoadedMetadata={(event) => {
            const node = event.currentTarget
            if (node.currentTime !== 0 || node.duration <= 0) return
            try {
              node.currentTime = Math.min(0.08, node.duration / 2)
            } catch {
              // 保持原生首帧
            }
          }}
        />
      )}
      <span
        className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100"
        style={{
          backgroundImage: 'linear-gradient(to top, rgba(0,0,0,.6), transparent 58%)',
        }}
      />
      <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-canvas/90 text-ink shadow-lift">
          <Play size={13} className="translate-x-[1px]" />
        </span>
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-2 pb-1.5 text-xs font-medium text-canvas opacity-0 transition group-hover:opacity-100">
        {pack.name}
      </span>
      <button
        type="button"
        title="删除案例"
        aria-label="删除案例"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-canvas/85 text-ink opacity-100 transition hover:bg-err hover:text-canvas sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

export function CaseShowcase({ limit }: { limit?: number }) {
  const cases = useApp((s) => s.data.cases)
  const addCase = useApp((s) => s.addCase)
  const removeCase = useApp((s) => s.removeCase)
  const addProject = useApp((s) => s.addProject)
  const toast = useApp((s) => s.toast)

  const [active, setActive] = useState<CasePack | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CasePack | null>(null)
  const [busy, setBusy] = useState(false)
  const visibleCases = limit ? cases.slice(0, limit) : cases

  const importFile = (file: File | undefined) => {
    if (!file) return
    const input = file
    void (async () => {
      setBusy(true)
      try {
        const { pack, videos } = await readPackFile(input)
        const casePack = packToCase(pack, videos)
        addCase(casePack)
        toast(`已导入案例：${pack.name}`)
      } catch (err) {
        toast(`导入失败：${(err as Error).message}`, 'err')
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <section className="flex flex-col gap-3 md:h-full md:min-h-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="section-title">案例</span>
        <label className="btn ml-auto px-3 py-1.5 text-xs">
          <Upload size={13} />
          {busy ? '导入中…' : '导入案例包'}
          <input
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="hidden"
            onChange={(e) => {
              importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {cases.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[16px] border border-line bg-canvas px-6 py-6 text-center">
          <CloudDownload size={22} className="text-dim" />
          <div className="text-sm text-ink">还没有案例</div>
          <div className="text-xs text-dim">
            导入 .jueying.zip 案例包后，可在这里预览视频并一键复制项目。
          </div>
          <label className="btn btn-primary mt-1">
            <Upload size={14} />
            导入案例包
            <input
              type="file"
              accept=".zip,.json,application/zip,application/json"
              className="hidden"
              onChange={(e) => {
                importFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {visibleCases.map((pack) => (
            <CaseCard
              key={pack.id}
              pack={pack}
              onOpen={() => setActive(pack)}
              onDelete={() => setConfirmDelete(pack)}
            />
          ))}
        </div>
      )}

      {active && (
        <Modal
          title={active.name}
          onClose={() => setActive(null)}
          wide
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setActive(null)}>
                关闭
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  addProject(caseToProject(active))
                  toast(`已复制项目：${active.name}`)
                  setActive(null)
                }}
              >
                <Copy size={14} />
                复制项目
              </button>
            </>
          }
        >
          <CasePlayer pack={active} />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
            <span className="rounded-md border border-line px-2.5 py-0.5">
              {active.author || '本地导入'}
            </span>
            <span className="rounded-md border border-line px-2.5 py-0.5">
              {active.shots.length} 个视频
            </span>
          </div>
          {active.description && <p className="text-xs text-dim">{active.description}</p>}
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="删除案例"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  removeCase(confirmDelete.id)
                  if (active?.id === confirmDelete.id) setActive(null)
                  setConfirmDelete(null)
                  toast('案例已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>确定删除案例「{confirmDelete.name}」？案例里的视频文件也会一并删除。</p>
        </Modal>
      )}
    </section>
  )
}

function CasePlayer({ pack }: { pack: CasePack }) {
  const video = firstVideo(pack)
  if (video) {
    return (
      <video
        src={video}
        controls
        autoPlay
        playsInline
        className="aspect-video w-full rounded-[16px] bg-black object-contain"
      />
    )
  }
  return (
    <div
      className="grid aspect-video w-full place-items-center rounded-[16px] border border-line text-sm text-dim"
      style={coverStyle(pack.id)}
    >
      该案例没有视频文件
    </div>
  )
}
