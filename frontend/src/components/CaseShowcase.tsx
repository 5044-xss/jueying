import { CloudDownload, Copy, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { qk, useCases, useImportCase, useInstallCases } from '../api/queries'
import type { CaseInfo, CasesInstallStatus } from '../api/types'
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
          暂无演示视频
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
  const qc = useQueryClient()
  const { data } = useCases()
  const install = useInstallCases()
  const importCase = useImportCase()

  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState<CasesInstallStatus | null>(null)
  const [active, setActive] = useState<CaseInfo | null>(null)
  const [busy, setBusy] = useState(false)

  // 下载中轮询进度
  useEffect(() => {
    if (!installing) return
    let stop = false
    const tick = async () => {
      try {
        const s = await api.casesInstallStatus()
        if (stop) return
        setStatus(s)
        if (s.state === 'done') {
          setInstalling(false)
          qc.invalidateQueries({ queryKey: qk.cases })
          toast.success('案例已就绪')
        } else if (s.state === 'error') {
          setInstalling(false)
          toast.error(`案例安装失败：${s.error}`)
        } else {
          window.setTimeout(tick, 1500)
        }
      } catch {
        window.setTimeout(tick, 2000)
      }
    }
    void tick()
    return () => {
      stop = true
    }
  }, [installing, qc])

  async function onInstall() {
    setInstalling(true)
    setStatus({ state: 'downloading', progress: 0, error: '' })
    try {
      await install.mutateAsync()
    } catch (e) {
      setInstalling(false)
      toast.error(`下载失败：${(e as Error).message}`)
    }
  }

  async function onImport(c: CaseInfo) {
    setBusy(true)
    try {
      const r = await importCase.mutateAsync({ name: c.name })
      toast.success(`已复制到记录 · 分组「${r.project}」（${r.count} 条）`)
      setActive(null)
    } catch (e) {
      toast.error(`复制失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const items = data?.items ?? []
  const bundled = data?.bundled ?? false

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">案例展示</h2>
        <span className="text-xs text-dim">悬停预览 · 点击播放</span>
      </div>

      {data && !data.installed ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line px-4 py-10 text-center">
          <CloudDownload size={22} className="text-dim" />
          <div className="text-sm text-ink">
            {bundled ? '案例已随软件内置，安装一次即可使用' : '案例需要先下载一次（约几十 MB）'}
          </div>
          <div className="text-xs text-dim">
            安装后存在本地，之后离线可用，升级软件不会重复下载
          </div>
          {installing ? (
            <div className="flex items-center gap-2 text-xs text-dim">
              <Spinner className="h-4 w-4" />
              {bundled ? '正在安装' : '正在下载'} {status?.progress ?? 0}%
            </div>
          ) : (
            <Button variant="primary" onClick={() => void onInstall()}>
              <CloudDownload size={14} /> {bundled ? '安装案例' : '下载案例'}
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-line px-4 py-10 text-sm text-dim">
          暂无案例
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((c) => (
            <CaseCard
              key={c.name}
              name={c.name}
              src={c.hasCover ? api.caseCoverUrl(c.name) : ''}
              onOpen={() => setActive(c)}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.name ?? ''}
        width={760}
        footer={
          <Button variant="primary" disabled={busy} onClick={() => active && void onImport(active)}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <Copy size={13} />} 复制项目
          </Button>
        }
      >
        {active &&
          (active.hasCover ? (
            <div className="flex h-[clamp(240px,56vh,520px)] items-center justify-center overflow-hidden rounded-2xl bg-black">
              <video
                key={active.name}
                src={api.caseCoverUrl(active.name)}
                controls
                autoPlay
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="grid h-48 place-items-center rounded-2xl border border-dashed border-line text-sm text-dim">
              暂无演示视频
            </div>
          ))}
      </Modal>
    </section>
  )
}
