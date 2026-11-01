import { useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Library, Search, Upload } from 'lucide-react'
import { newId } from '@/core/id'
import type { LibraryAsset, MediaRef } from '@/core/types'
import { mediaKind } from '@/lib/assets'
import { pickGalleryImages, readMedia } from '@/lib/media'
import { useApp } from '@/store/app'
import { AssetGrid, type AssetItem } from '@/components/AssetGrid'
import { RenameDialog } from '@/components/RenameDialog'
import { PageHeader } from '@/ui/PageHeader'
import { Modal } from '@/ui/Modal'

export function LibraryPage() {
  const assets = useApp((s) => s.data.assets)
  const addAsset = useApp((s) => s.addAsset)
  const removeAsset = useApp((s) => s.removeAsset)
  const renameAsset = useApp((s) => s.renameAsset)
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [confirm, setConfirm] = useState<LibraryAsset | null>(null)
  const [renaming, setRenaming] = useState<LibraryAsset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const native = Capacitor.isNativePlatform()

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return assets
    return assets.filter((a) => a.name.toLowerCase().includes(keyword))
  }, [assets, query])

  const items: AssetItem[] = filtered.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    url: a.url,
    source: a.sourceProjectName,
  }))

  const addMedia = (media: MediaRef[]) => {
    if (!media.length) return
    media.forEach((item) => {
      addAsset({
        id: newId('asset'),
        name: item.name,
        kind: mediaKind(item.name),
        url: item.url,
        path: item.path,
        createdAt: Date.now(),
      })
    })
    toast(media.length > 1 ? `已上传 ${media.length} 个素材` : `已上传：${media[0].name}`)
  }

  const upload = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length || uploading) return
    void (async () => {
      setUploading(true)
      try {
        addMedia(await Promise.all(list.map(readMedia)))
      } catch (err) {
        toast(`上传失败：${(err as Error).message}`, 'err')
      } finally {
        setUploading(false)
      }
    })()
  }

  const uploadFromGallery = () => {
    if (uploading) return
    if (!native) {
      fileRef.current?.click()
      return
    }
    void (async () => {
      setUploading(true)
      try {
        addMedia(await pickGalleryImages())
      } catch (err) {
        toast(`打开图库失败：${(err as Error).message}`, 'err')
      } finally {
        setUploading(false)
      }
    })()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <PageHeader
        eyebrow="Library"
        accent="lime"
        title="资产库"
        description="全局可复用的图片素材。项目素材页可存入这里，生成台上传时可直接选用。"
        block="pink"
        actions={
          <button
            type="button"
            className={`btn ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            onClick={uploadFromGallery}
            disabled={uploading}
          >
            <Upload size={15} />
            {uploading ? '上传中…' : native ? '从图库选择' : '上传素材'}
          </button>
        }
      />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          upload(e.target.files)
          e.target.value = ''
        }}
      />

      {assets.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas px-6 py-14 text-center">
          <Library size={22} className="text-dim" />
          <b className="text-sm font-medium">全局资产库还是空的</b>
          <p className="max-w-md text-xs leading-relaxed text-dim">
            在项目详情的「素材」页点素材卡片上的入库按钮，或在右上角直接上传素材。
          </p>
          <button
            type="button"
            className="btn mt-1"
            onClick={uploadFromGallery}
            disabled={uploading}
          >
            <Upload size={14} />
            {uploading ? '上传中…' : native ? '从图库选择' : '上传素材'}
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索资产名称"
                aria-label="搜索资产名称"
                className="input h-8 py-0 pl-9 text-sm"
              />
            </div>
            <span className="text-xs text-dim">
              共 {assets.length} 个
              {query.trim() ? ` · 匹配 ${filtered.length} 个` : ''}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-canvas py-14 text-center text-sm text-dim">
              <p>没有匹配「{query.trim()}」的资产。</p>
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
              <AssetGrid
                items={items}
                onRename={(id) => {
                  const asset = assets.find((a) => a.id === id)
                  if (asset) setRenaming(asset)
                }}
                onRemove={(id) => {
                  const asset = assets.find((a) => a.id === id)
                  if (asset) setConfirm(asset)
                }}
              />
            </div>
          )}
        </div>
      )}

      {renaming && (
        <RenameDialog
          title="重命名素材"
          label="素材名称"
          initial={renaming.name}
          placeholder="输入素材名称"
          onSubmit={(name) => {
            renameAsset(renaming.id, name)
            toast('素材名称已更新')
          }}
          onClose={() => setRenaming(null)}
        />
      )}

      {confirm && (
        <Modal
          title="删除资产"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  removeAsset(confirm.id)
                  setConfirm(null)
                  toast('资产已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>确定从全局资产库删除「{confirm.name}」？此操作不可恢复。</p>
        </Modal>
      )}
    </div>
  )
}
