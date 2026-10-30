import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  Copy,
  Download,
  Film,
  FolderOpen,
  Maximize2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Shot, ShotState } from '@/core/types'
import { ComfyClient } from '@/core/comfy'
import { cancelShotJob } from '@/core/generate'
import { mediaKind, mediaToAsset, projectAssets } from '@/lib/assets'
import { elapsedText, isActiveShot } from '@/lib/jobs'
import { readMedia } from '@/lib/media'
import { downloadProjectFile } from '@/lib/projectFile'
import { useNow } from '@/lib/useNow'
import { activeEndpoint, useApp } from '@/store/app'
import { AssetGrid, type AssetItem } from '@/components/AssetGrid'
import { ShotPreviewModal } from '@/components/ShotPreviewModal'
import { Modal } from '@/ui/Modal'
import { PageHeader } from '@/ui/PageHeader'
import { JobProgress } from '@/ui/JobProgress'
import { VideoBox } from '@/ui/VideoBox'

const PILL: Record<ShotState, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'border-line bg-canvas text-warn' },
  running: { label: '生成中', className: 'border-line bg-canvas text-warn' },
  success: { label: '已完成', className: 'border-line bg-canvas text-ok' },
  error: { label: '失败', className: 'border-err/30 bg-canvas text-err' },
  cancelled: { label: '已取消', className: 'border-line bg-canvas text-dim' },
}

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const project = useApp((s) => s.data.projects.find((p) => p.id === projectId))
  const closeProject = useApp((s) => s.closeProject)
  const setGenProject = useApp((s) => s.setGenProject)
  const deleteProject = useApp((s) => s.deleteProject)
  const deleteShot = useApp((s) => s.deleteShot)
  const copyShot = useApp((s) => s.copyShot)
  const editShot = useApp((s) => s.editShot)
  const addAsset = useApp((s) => s.addAsset)
  const addProjectAssets = useApp((s) => s.addProjectAssets)
  const removeProjectAsset = useApp((s) => s.removeProjectAsset)
  const libraryAssets = useApp((s) => s.data.assets)
  const toast = useApp((s) => s.toast)
  const [confirming, setConfirming] = useState(false)
  const [confirmShot, setConfirmShot] = useState<Shot | null>(null)
  const [confirmAsset, setConfirmAsset] = useState<AssetItem | null>(null)
  const [query, setQuery] = useState('')
  const [assetQuery, setAssetQuery] = useState('')
  const [tab, setTab] = useState<'videos' | 'assets'>('videos')
  const [playing, setPlaying] = useState<Shot | null>(null)
  const [uploading, setUploading] = useState(false)
  const hasActive = Boolean(project?.shots.some(isActiveShot))
  const now = useNow(hasActive)

  const filteredShots = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = project?.shots ?? []
    if (!keyword) return list
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(keyword) ||
        s.prompt.toLowerCase().includes(keyword),
    )
  }, [project?.shots, query])

  if (!project) return null

  const done = project.shots.filter((s) => s.state === 'success').length
  const totalSec = project.shots.reduce((sum, s) => sum + (s.params.duration || 0), 0)
  const assets = projectAssets(project)
  const projectAssetIds = new Set((project.assets ?? []).map((m) => m.id))

  const assetItems: AssetItem[] = assets
    .filter((m) => {
      const keyword = assetQuery.trim().toLowerCase()
      if (!keyword) return true
      return m.name.toLowerCase().includes(keyword)
    })
    .map((m) => ({
      id: m.id,
      name: m.name,
      kind: mediaKind(m.name),
      url: m.url,
      removable: projectAssetIds.has(m.id),
    }))

  const saveToGlobal = (id: string) => {
    const media = assets.find((m) => m.id === id)
    if (!media) return
    if (libraryAssets.some((a) => a.id === media.id)) {
      toast('该素材已在全局资产库')
      return
    }
    addAsset(mediaToAsset(media, project))
    toast('已存入全局资产库')
  }

  const uploadAssets = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length || uploading) return
    void (async () => {
      setUploading(true)
      try {
        const media = await Promise.all(list.map(readMedia))
        addProjectAssets(project.id, media)
        toast(`已添加 ${media.length} 个素材`)
      } catch (err) {
        toast(`上传失败：${(err as Error).message}`, 'err')
      } finally {
        setUploading(false)
      }
    })()
  }

  const exportProject = () => {
    void (async () => {
      try {
        await downloadProjectFile(project)
        toast('已导出项目（含视频）')
      } catch (err) {
        toast(`导出失败：${(err as Error).message}`, 'err')
      }
    })()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center gap-2 text-sm text-dim">
        <button
          onClick={closeProject}
          className="flex items-center gap-1 transition hover:text-ink"
        >
          <ChevronLeft size={15} />
          项目
        </button>
        <span className="text-dim/50">/</span>
        <span className="truncate text-ink">{project.name}</span>
      </div>

      <div className="shrink-0">
        <PageHeader
          eyebrow="Project"
          accent="cream"
          title={project.name}
          description="项目下的所有视频在此管理。"
          block="cream"
          actions={
            <>
              <button className="btn" onClick={exportProject}>
                <Download size={15} />
                导出
              </button>
              <button
                className="btn text-err hover:bg-err/5"
                onClick={() => setConfirming(true)}
                title="删除项目"
              >
                <Trash2 size={15} />
                删除
              </button>
              <button className="btn btn-primary" onClick={() => setGenProject(project.id)}>
                <Sparkles size={15} />
                去生成台
              </button>
            </>
          }
        />
      </div>

      <div className="mt-5 inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-soft p-1">
        {(
          [
            { key: 'videos', label: '视频' },
            { key: 'assets', label: '素材' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === key ? 'bg-ink text-canvas' : 'text-dim hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'videos' ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索视频名称或提示词"
                aria-label="搜索视频"
                className="input h-8 py-0 pl-9 text-sm"
              />
            </div>
            <span className="text-xs text-dim">
              共 {project.shots.length} 个视频
              {query.trim() ? ` · 匹配 ${filteredShots.length} 个` : ''}
            </span>
            <span className="ml-auto text-xs text-dim">
              {done} 成片 · 总时长 {totalSec}s
            </span>
          </div>

          {project.shots.length === 0 ? (
            <EmptyShot onGo={() => setGenProject(project.id)} />
          ) : filteredShots.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl bg-cream py-12 text-center text-sm text-ink/60">
              <p>没有匹配「{query.trim()}」的视频。</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-xs underline underline-offset-4 hover:text-ink"
              >
                清空搜索
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filteredShots.map((shot) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  now={now}
                  onPlay={() => setPlaying(shot)}
                  onEdit={() => editShot(project.id, shot.id)}
                  onCopy={() => {
                    copyShot(project.id, shot.id)
                    toast('视频已复制')
                  }}
                  onDelete={() => setConfirmShot(shot)}
                  onReveal={() => {
                    if (!shot.output) return
                    if (window.desktop?.media?.reveal) {
                      void window.desktop.media
                        .reveal(shot.output)
                        .catch(() => toast('打开文件夹失败', 'err'))
                    } else {
                      toast('请使用桌面端打开文件夹', 'err')
                    }
                  }}
                />
              ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
              <input
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                placeholder="搜索素材名称"
                aria-label="搜索素材名称"
                className="input h-8 py-0 pl-9 text-sm"
              />
            </div>
            <span className="text-xs text-dim">
              共 {assets.length} 个
              {assetQuery.trim() ? ` · 匹配 ${assetItems.length} 个` : ''}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className={`btn px-3 py-1.5 text-xs ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                <Upload size={13} />
                {uploading ? '上传中…' : '上传素材'}
                <input
                  type="file"
                  accept="image/*,audio/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    uploadAssets(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <button className="btn px-3 py-1.5 text-xs" onClick={() => setGenProject(project.id)}>
                <Sparkles size={13} />
                去生成台
              </button>
            </div>
          </div>

          {assets.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line bg-canvas px-4 py-12 text-center">
              <Plus size={20} className="text-dim/50" />
              <div className="text-sm text-ink">还没有素材</div>
              <p className="text-xs text-dim">
                可以直接手动上传图片或音频，也可以去生成台把参考图、首尾帧加入项目。
              </p>
              <div className="mt-1 flex items-center gap-2">
                <label className="btn btn-primary">
                  <Upload size={14} />
                  {uploading ? '上传中…' : '上传素材'}
                  <input
                    type="file"
                    accept="image/*,audio/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      uploadAssets(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </label>
                <button className="btn" onClick={() => setGenProject(project.id)}>
                  <Sparkles size={14} />
                  去生成台
                </button>
              </div>
            </div>
          ) : assetItems.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-canvas py-14 text-center text-sm text-dim">
              <p>没有匹配「{assetQuery.trim()}」的素材。</p>
              <button
                type="button"
                onClick={() => setAssetQuery('')}
                className="text-xs underline underline-offset-4 hover:text-ink"
              >
                清空搜索
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2">
              <AssetGrid
                items={assetItems}
                onAddGlobal={(item) => saveToGlobal(item.id)}
                onRemove={(id) => {
                  const item = assetItems.find((a) => a.id === id)
                  if (item) setConfirmAsset(item)
                }}
              />
            </div>
          )}
        </div>
      )}

      {confirming && (
        <Modal
          title="删除项目"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  deleteProject(project.id)
                  setConfirming(false)
                  toast('项目已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>删除后该项目的所有视频记录及本地文件都会移除，不可恢复。</p>
        </Modal>
      )}

      {confirmShot && (
        <Modal
          title="删除视频"
          onClose={() => setConfirmShot(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmShot(null)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  deleteShot(project.id, confirmShot.id)
                  setConfirmShot(null)
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

      {confirmAsset && (
        <Modal
          title="删除素材"
          onClose={() => setConfirmAsset(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmAsset(null)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  removeProjectAsset(project.id, confirmAsset.id)
                  setConfirmAsset(null)
                  toast('素材已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>确定从项目素材中删除「{confirmAsset.name}」？此操作不可恢复。</p>
        </Modal>
      )}

      {playing && (
        <ShotPreviewModal shot={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  )
}

function ShotCard({
  shot,
  now,
  onPlay,
  onEdit,
  onCopy,
  onDelete,
  onReveal,
}: {
  shot: Shot
  now: number
  onPlay: () => void
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  onReveal: () => void
}) {
  const pill = PILL[shot.state]
  const active = isActiveShot(shot)
  const endpoint = useApp(activeEndpoint)
  const endpoints = useApp((s) => s.data.endpoints)
  const updateShot = useApp((s) => s.updateShot)
  const toast = useApp((s) => s.toast)

  const cancel = () => {
    const target = endpoints.find((e) => e.id === shot.endpointId) ?? endpoint
    if (!target) {
      toast('找不到生成端，无法取消', 'err')
      return
    }
    void cancelShotJob({
      client: new ComfyClient(target.url, target.token),
      shot,
      update: (patch) => updateShot(shot.projectId, shot.id, patch),
      toast,
    })
  }

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas transition hover:border-ink/20">
      <button
        type="button"
        onClick={onPlay}
        disabled={!shot.output}
        className="relative aspect-video w-full overflow-hidden bg-soft text-left disabled:cursor-default"
      >
        {shot.output ? (
          <VideoBox src={shot.output} className="size-full object-cover" hoverPlay />
        ) : (
          <span className="grid size-full place-items-center bg-soft text-dim/50">
            <Film size={20} />
          </span>
        )}
        <span
          className={`absolute left-2 top-2 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${pill.className}`}
        >
          {pill.label}
        </span>
        {shot.output && (
          <span className="absolute bottom-2 right-2 rounded-md bg-canvas/90 p-1 text-ink opacity-0 transition group-hover:opacity-100">
            <Maximize2 size={12} />
          </span>
        )}
      </button>

      <div className="flex min-w-0 items-center gap-1 px-3 pt-2.5">
        <b className="min-w-0 flex-1 truncate text-sm font-medium">{shot.name}</b>
        <button
          type="button"
          onClick={onReveal}
          disabled={!shot.output}
          title="打开所在文件夹"
          aria-label="打开所在文件夹"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-dim transition hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderOpen size={13} />
        </button>
      </div>
      <p className="px-3 text-xs text-dim">
        创建于 {new Date(shot.createdAt).toLocaleString('zh-CN')}
      </p>

      {active && (
        <div className="px-3 pt-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-[10px] text-dim">
              {pill.label}
              {typeof shot.progress === 'number' ? ` ${shot.progress}%` : ''} ·{' '}
              {elapsedText(shot.createdAt, now)}
            </span>
            <button
              type="button"
              onClick={cancel}
              title="取消生成"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-err/30 bg-err/5 px-2 py-0.5 text-[10px] font-medium text-err transition hover:bg-err/10"
            >
              <Square size={9} />
              取消
            </button>
          </div>
          <JobProgress state={shot.state} progress={shot.progress} className="mt-1" />
        </div>
      )}

      <div className="grid grid-cols-4 items-center gap-1.5 px-2.5 pb-2.5 pt-2">
        <button
          className="btn btn-primary h-7 w-full px-1 text-[10.5px]"
          onClick={onPlay}
          disabled={!shot.output}
        >
          <Play size={12} />
          打开
        </button>
        <button className="btn h-7 w-full px-1 text-[10.5px]" onClick={onEdit}>
          <Pencil size={12} />
          编辑
        </button>
        <button className="btn h-7 w-full px-1 text-[10.5px]" onClick={onCopy}>
          <Copy size={12} />
          复制
        </button>
        <button
          className="btn h-7 w-full px-1 text-[10.5px] text-err hover:bg-err/5"
          onClick={onDelete}
        >
          <Trash2 size={12} />
          删除
        </button>
      </div>
    </article>
  )
}

function EmptyShot({ onGo }: { onGo: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas py-12 text-center">
      <Film size={20} className="text-ink/50" />
      <b className="mt-1 text-sm font-medium">这个项目还没有视频</b>
      <p className="text-xs text-ink/60">在生成台写下画面，回车即可生成第一个视频。</p>
      <button className="btn btn-primary mt-1" onClick={onGo}>
        <Sparkles size={14} />
        去生成台
      </button>
    </div>
  )
}
