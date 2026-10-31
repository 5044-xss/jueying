import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Download, FolderOpen, Loader2 } from 'lucide-react'
import type { Shot } from '@/core/types'
import { shareNativeMedia } from '@/platform/localMedia'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { cn } from '@/lib/utils'

type Tab = 'video' | 'prompt'

const TABS: { key: Tab; label: string }[] = [
  { key: 'video', label: '视频' },
  { key: 'prompt', label: '提示词' },
]

export function ShotPreviewModal({
  shot,
  onClose,
}: {
  shot: Shot
  onClose: () => void
}) {
  const toast = useApp((s) => s.toast)
  const [tab, setTab] = useState<Tab>('video')
  const [saving, setSaving] = useState(false)

  const canReveal = Boolean(window.desktop?.media?.reveal)
  const canShare = Capacitor.isNativePlatform() && Boolean(shot.outputPath)

  const reveal = () => {
    if (!shot.output) return
    if (window.desktop?.media?.reveal) {
      void window.desktop.media
        .reveal(shot.output)
        .catch(() => toast('打开成片目录失败', 'err'))
    }
  }

  const share = () => {
    if (!shot.outputPath || saving) return
    void (async () => {
      setSaving(true)
      try {
        const ok = await shareNativeMedia(shot.outputPath as string, shot.name)
        if (!ok) toast('当前环境不支持分享', 'err')
      } catch (err) {
        toast(`保存失败：${(err as Error).message}`, 'err')
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <Modal
      title={shot.name}
      onClose={onClose}
      wide
      footer={
        <>
          {canReveal && (
            <button className="btn" onClick={reveal} disabled={!shot.output}>
              <FolderOpen size={14} />
              打开成片目录
            </button>
          )}
          {canShare && (
            <button className="btn" onClick={share} disabled={saving || !shot.output}>
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {saving ? '准备中…' : '保存/分享'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="inline-flex w-fit items-center gap-1 rounded-full bg-soft p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab === key ? 'bg-ink text-canvas' : 'text-dim hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'video' ? (
        shot.output ? (
          <video
            id="shot-player"
            src={shot.output}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="w-full rounded-xl bg-black"
          />
        ) : (
          <p className="text-sm text-dim">还没有成片。</p>
        )
      ) : (
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-soft p-3 text-xs leading-relaxed text-ink">
          {shot.prompt || '没有提示词'}
        </div>
      )}
    </Modal>
  )
}
