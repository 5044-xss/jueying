import { useState } from 'react'
import { FolderOpen, Pencil, RotateCw, Trash2 } from 'lucide-react'
import type { Shot } from '@/core/types'
import { ComfyClient } from '@/core/comfy'
import { runShotJob } from '@/core/generate'
import { activeEndpoint, useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { cn } from '@/lib/utils'

const ACTIONS = [
  { key: 'rerun', label: '重跑', icon: RotateCw, tone: 'bg-lime hover:bg-lime' },
  { key: 'edit', label: '编辑', icon: Pencil, tone: 'bg-cream hover:bg-cream' },
  { key: 'open', label: '打开', icon: FolderOpen, tone: 'bg-mint hover:bg-mint' },
  { key: 'delete', label: '删除', icon: Trash2, tone: 'bg-pink hover:bg-pink' },
] as const

export function ShotActions({ projectId, shot }: { projectId: string; shot: Shot }) {
  const endpoint = useApp(activeEndpoint)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const updateShot = useApp((s) => s.updateShot)
  const deleteShot = useApp((s) => s.deleteShot)
  const editShot = useApp((s) => s.editShot)
  const toast = useApp((s) => s.toast)
  const [confirming, setConfirming] = useState(false)

  const active = shot.state === 'queued' || shot.state === 'running'

  const rerun = () => {
    if (active) return
    if (!endpoint) {
      setSettingsOpen(true)
      toast('先连接生成端', 'err')
      return
    }
    const next: Shot = {
      ...shot,
      state: 'queued',
      endpointId: endpoint.id,
      progress: undefined,
      error: undefined,
      output: undefined,
      remoteOutput: undefined,
      outputPath: undefined,
      finishedAt: null,
    }
    updateShot(projectId, shot.id, next)
    void runShotJob({
      client: new ComfyClient(endpoint.url, endpoint.token),
      endpointId: endpoint.id,
      shot: next,
      images: next.images,
      audios: next.audios ?? [],
      firstFrame: next.firstFrame,
      lastFrame: next.lastFrame,
      update: (patch) => updateShot(projectId, shot.id, patch),
      toast,
    })
  }

  const openOutput = async () => {
    if (!shot.output) {
      toast('还没有成片文件', 'err')
      return
    }
    try {
      if (window.desktop?.media?.open) {
        await window.desktop.media.open(shot.output)
      } else {
        window.open(shot.output, '_blank')
      }
    } catch (err) {
      toast((err as Error).message || '打开失败', 'err')
    }
  }

  const run = (key: (typeof ACTIONS)[number]['key']) => {
    if (key === 'rerun') rerun()
    if (key === 'edit') editShot(projectId, shot.id)
    if (key === 'open') void openOutput()
    if (key === 'delete') setConfirming(true)
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {ACTIONS.map(({ key, label, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            onClick={() => run(key)}
            disabled={key === 'rerun' && active}
            title={label}
            className={cn(
              'flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-medium text-ink/75 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
              tone,
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {confirming && (
        <Modal
          title="删除视频"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  deleteShot(projectId, shot.id)
                  setConfirming(false)
                  toast('视频已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>删除后该视频记录和对应的本地成片文件都会被移除，不可恢复。</p>
        </Modal>
      )}
    </>
  )
}
