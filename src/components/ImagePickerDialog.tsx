import { useMemo, useRef, useState } from 'react'
import { Check, ImagePlus, Library, Upload, X } from 'lucide-react'
import { newId } from '@/core/id'
import type { MediaRef } from '@/core/types'
import { mediaKind, projectAssets } from '@/lib/assets'
import { readMedia } from '@/lib/media'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { cn } from '@/lib/utils'

interface Item {
  key: string
  name: string
  url?: string
  media: MediaRef
  uploaded?: boolean
}

export function ImagePickerDialog({
  projectId,
  single,
  onClose,
  onPick,
}: {
  projectId?: string
  single?: boolean
  onClose: () => void
  onPick: (media: MediaRef[]) => void
}) {
  const projects = useApp((s) => s.data.projects)
  const assets = useApp((s) => s.data.assets)
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [selected, setSelected] = useState<Map<string, MediaRef>>(new Map())
  const [uploaded, setUploaded] = useState<Item[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const project = projects.find((p) => p.id === projectId)

  const projectItems: Item[] = useMemo(
    () =>
      projectAssets(project)
        .filter((media) => mediaKind(media.name) === 'image')
        .map((media) => ({
          key: `p:${media.id}`,
          name: media.name,
          url: media.url,
          media,
        })),
    [project],
  )

  const globalItems: Item[] = useMemo(
    () =>
      assets
        .filter((a) => a.kind === 'image')
        .map((a) => ({
          key: `g:${a.id}`,
          name: a.name,
          url: a.url,
          media: { id: a.id, name: a.name, url: a.url, path: a.path },
        })),
    [assets],
  )

  const items = scope === 'project' ? projectItems : globalItems
  const visibleItems = [...uploaded, ...items]

  const finish = (media: MediaRef[]) => {
    onPick(media.map((m) => ({ ...m, id: newId('media') })))
    onClose()
  }

  const toggle = (item: Item) => {
    if (single) {
      finish([item.media])
      return
    }
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.key)) next.delete(item.key)
      else next.set(item.key, item.media)
      return next
    })
  }

  const upload = (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, single ? 1 : undefined)
    if (!list.length || uploading) return
    void (async () => {
      setUploading(true)
      try {
        const mediaList = await Promise.all(list.map(readMedia))
        if (single) {
          finish(mediaList.slice(0, 1))
          return
        }
        const items: Item[] = mediaList.map((media) => ({
          key: `u:${media.id}`,
          name: media.name,
          url: media.url,
          media,
          uploaded: true,
        }))
        setUploaded((prev) => [...items, ...prev])
        setSelected((prev) => {
          const next = new Map(prev)
          for (const item of items) next.set(item.key, item.media)
          return next
        })
      } finally {
        setUploading(false)
      }
    })()
  }

  const removeSelected = (mediaId: string) =>
    setSelected((prev) => {
      const next = new Map(prev)
      for (const [key, value] of next) {
        if (value.id === mediaId) next.delete(key)
      }
      return next
    })

  const selectedList = [...selected.values()]

  return (
    <Modal
      title="选择图片"
      onClose={onClose}
      wide
      footer={
        single ? (
          <button className="btn" onClick={onClose}>
            取消
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => finish(selectedList)}
              disabled={selectedList.length === 0}
            >
              添加 {selectedList.length} 张
            </button>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
          <Upload size={13} />
          {uploading ? '上传中…' : '手动上传'}
        </button>
        <div className="ml-auto inline-flex items-center gap-1 rounded-full bg-soft p-1">
          {(
            [
              { key: 'project', label: '项目素材' },
              { key: 'global', label: '全局资产库' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                scope === key ? 'bg-ink text-canvas' : 'text-dim hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={!single}
        className="hidden"
        onChange={(e) => {
          upload(e.target.files)
          e.target.value = ''
        }}
      />

      {visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line px-4 py-10 text-center">
          {scope === 'project' ? (
            <ImagePlus size={20} className="text-dim/50" />
          ) : (
            <Library size={20} className="text-dim/50" />
          )}
          <p className="text-sm text-ink">
            {scope === 'project' ? '这个项目还没有图片素材' : '全局资产库还没有图片'}
          </p>
          <p className="text-xs text-dim">
            {scope === 'project'
              ? '可以直接手动上传，或先去项目素材页存入全局资产库。'
              : '在项目素材页把图片存入全局资产库后，就能在这里复用。'}
          </p>
        </div>
      ) : (
        <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
          {visibleItems.map((item) => {
            const active = selected.has(item.key)
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggle(item)}
                className={cn(
                  'group relative flex flex-col gap-1 rounded-lg border p-1.5 text-left transition',
                  active ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-soft',
                )}
              >
                <span className="grid h-24 w-full place-items-center overflow-hidden rounded bg-soft">
                  {item.url ? (
                    <img
                      src={item.url}
                      alt={item.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImagePlus size={18} className="text-dim/50" />
                  )}
                </span>
                {!item.uploaded && (
                  <span className="truncate text-[11px] text-dim" title={item.name}>
                    {item.name}
                  </span>
                )}
                {active && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-ink text-canvas">
                    <Check size={12} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!single && selectedList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedList.map((media) => (
            <div
              key={media.id}
              className="group relative h-14 w-14 overflow-hidden rounded-lg border border-line bg-soft"
            >
              {media.url ? (
                <img src={media.url} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="grid h-full w-full place-items-center text-dim/50">
                  <ImagePlus size={16} />
                </span>
              )}
              <button
                type="button"
                onClick={() => removeSelected(media.id)}
                title="移除"
                aria-label="移除"
                className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-ink/70 text-canvas opacity-0 transition hover:bg-err group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
