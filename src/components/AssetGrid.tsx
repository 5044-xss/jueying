import { useState } from 'react'
import { createPortal } from 'react-dom'
import { BookmarkPlus, Film, Maximize2, Music, Trash2, X } from 'lucide-react'
import type { AssetKind } from '@/core/types'
import { ASSET_KIND_LABEL } from '@/lib/assets'
import { cn } from '@/lib/utils'

export interface AssetItem {
  id: string
  name: string
  kind: AssetKind
  url?: string
  source?: string
  removable?: boolean
}

export function AssetGrid({
  items,
  onRemove,
  onAddGlobal,
}: {
  items: AssetItem[]
  onRemove?: (id: string) => void
  onAddGlobal?: (item: AssetItem) => void
}) {
  const [preview, setPreview] = useState<AssetItem | null>(null)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((item) => (
          <AssetCard
            key={item.id}
            item={item}
            onRemove={onRemove}
            onAddGlobal={onAddGlobal}
            onPreview={setPreview}
          />
        ))}
      </div>

      {preview?.url &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/85 p-6"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label={preview.name}
          >
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-lift"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={() => setPreview(null)}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-canvas/10 text-canvas transition hover:bg-canvas/20"
            >
              <X size={18} />
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}

function AssetCard({
  item,
  onRemove,
  onAddGlobal,
  onPreview,
}: {
  item: AssetItem
  onRemove?: (id: string) => void
  onAddGlobal?: (item: AssetItem) => void
  onPreview: (item: AssetItem) => void
}) {
  const previewable = item.kind === 'image' && Boolean(item.url)

  return (
    <div
      className={cn(
        'group flex flex-col gap-2 rounded-2xl border border-line bg-canvas p-3 transition',
        previewable && 'cursor-zoom-in hover:border-ink/20',
      )}
      onClick={previewable ? () => onPreview(item) : undefined}
      title={previewable ? '点击预览' : undefined}
      role={previewable ? 'button' : undefined}
      tabIndex={previewable ? 0 : undefined}
      onKeyDown={
        previewable
          ? (e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPreview(item)
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium" title={item.name}>
            {item.name}
          </span>
          <span className="shrink-0 rounded-md border border-line bg-soft px-1.5 py-0.5 text-[10px] text-dim">
            {ASSET_KIND_LABEL[item.kind]}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          {onAddGlobal && (
            <button
              type="button"
              title="存入全局资产库"
              aria-label="存入全局资产库"
              onClick={(e) => {
                e.stopPropagation()
                onAddGlobal(item)
              }}
              className="grid h-6 w-6 place-items-center rounded-md text-dim transition hover:bg-soft hover:text-ink"
            >
              <BookmarkPlus size={13} />
            </button>
          )}
          {onRemove && item.removable !== false && (
            <button
              type="button"
              title="从资产库删除"
              aria-label="从资产库删除"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(item.id)
              }}
              className="grid h-6 w-6 place-items-center rounded-md text-dim transition hover:bg-err/5 hover:text-err"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {item.source && (
        <span className="truncate text-[11px] text-dim">来自 {item.source}</span>
      )}

      <div
        className={cn(
          'relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-md bg-soft',
          item.kind !== 'image' && 'text-dim/50',
        )}
      >
        {item.kind === 'image' && item.url ? (
          <img
            src={item.url}
            alt={item.name}
            className="h-full w-full object-contain"
          />
        ) : item.kind === 'audio' ? (
          <Music size={20} />
        ) : (
          <Film size={20} />
        )}
        {previewable && (
          <span className="pointer-events-none absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-canvas/85 text-ink opacity-0 transition group-hover:opacity-100">
            <Maximize2 size={12} />
          </span>
        )}
      </div>
    </div>
  )
}
