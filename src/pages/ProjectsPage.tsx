import { useMemo, useState } from 'react'
import {
  Copy,
  Download,
  Film,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Project } from '@/core/types'
import { elapsedText, isActiveShot } from '@/lib/jobs'
import { downloadProjectFile, readProjectFile } from '@/lib/projectFile'
import { useNow } from '@/lib/useNow'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { PageHeader } from '@/ui/PageHeader'
import { JobProgress } from '@/ui/JobProgress'
import { NewProjectDialog } from '@/components/NewProjectDialog'

export function ProjectsPage() {
  const projects = useApp((s) => s.data.projects)
  const openProject = useApp((s) => s.openProject)
  const deleteProject = useApp((s) => s.deleteProject)
  const copyProject = useApp((s) => s.copyProject)
  const addProject = useApp((s) => s.addProject)
  const toast = useApp((s) => s.toast)
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const hasActive = projects.some((p) => p.shots.some(isActiveShot))
  const now = useNow(hasActive)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(keyword))
  }, [projects, query])

  const editing = projects.find((p) => p.id === editId)

  const exportProject = (project: Project) => {
    void (async () => {
      try {
        await downloadProjectFile(project)
        toast('已导出项目（含视频）')
      } catch (err) {
        toast(`导出失败：${(err as Error).message}`, 'err')
      }
    })()
  }

  const importProject = (file: File | undefined) => {
    if (!file || importing) return
    const input = file
    void (async () => {
      setImporting(true)
      try {
        const project = await readProjectFile(input)
        addProject(project)
        toast(`已导入项目：${project.name}`)
      } catch (err) {
        toast(`导入失败：${(err as Error).message}`, 'err')
      } finally {
        setImporting(false)
      }
    })()
  }

  const copy = (project: Project) => {
    const next = copyProject(project.id)
    if (next) toast('项目已复制')
    else toast('复制失败', 'err')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <PageHeader
        eyebrow="Projects"
        title="项目"
        description="项目是可编辑的工作单元：包含视频、参考素材、默认参数与成片。"
        block="lilac"
        actions={
          <>
            <label className={`btn ${importing ? 'pointer-events-none opacity-50' : ''}`}>
              <Upload size={15} />
              {importing ? '导入中…' : '导入项目'}
              <input
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                onChange={(e) => {
                  importProject(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              新建项目
            </button>
          </>
        }
      />
      </div>

      {projects.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line bg-canvas px-6 py-14 text-center">
          <div className="flex flex-col gap-1">
            <p className="font-medium">还没有项目</p>
            <p className="max-w-md text-sm leading-relaxed text-dim">
              新建一个项目开始生成，或导入已有的 .jueying.zip 项目包。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className="btn">
              <Upload size={15} />
              导入项目
              <input
                type="file"
                accept=".zip,.json,application/zip,application/json"
                className="hidden"
                onChange={(e) => {
                  importProject(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              新建项目
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目名称"
                aria-label="搜索项目名称"
                className="input h-8 py-0 pl-9 text-sm"
              />
            </div>
            <span className="text-xs text-dim">
              共 {projects.length} 个项目
              {query.trim() ? ` · 匹配 ${filtered.length} 个` : ''}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-canvas py-14 text-center text-sm text-dim">
              <p>没有匹配「{query.trim()}」的项目。</p>
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
              <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => {
                const done = p.shots.filter((s) => s.state === 'success').length
                const running = p.shots.find((s) => s.state === 'running')
                const queued = p.shots.some((s) => s.state === 'queued')
                const activeShot = p.shots.find(isActiveShot)
                const totalSec = p.shots.reduce((sum, s) => sum + (s.params.duration || 0), 0)

                return (
                  <article
                    key={p.id}
                    className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-4 transition hover:border-ink/20"
                  >
                    <div className="flex items-center gap-1">
                      <h3 className="min-w-0 flex-1 truncate text-base font-medium leading-snug">
                        {p.name}
                      </h3>
                      <button
                        onClick={() => exportProject(p)}
                        title="导出项目"
                        aria-label="导出项目"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-dim transition hover:bg-soft hover:text-ink"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => setEditId(p.id)}
                        title="编辑项目"
                        aria-label="编辑项目"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-dim transition hover:bg-soft hover:text-ink"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    <p className="text-xs text-dim">
                      创建于 {new Date(p.createdAt).toLocaleString('zh-CN')}
                    </p>

                    <div className="flex items-center gap-2 rounded-lg bg-soft px-2.5 py-1.5 text-[11px] text-dim">
                      <Film size={12} className="shrink-0" />
                      <span>
                        {p.shots.length} 个视频 · {done} 成片 · {totalSec}s
                      </span>
                      <span className="ml-auto shrink-0 text-ink/70">
                        {running
                          ? `生成中${typeof running.progress === 'number' ? ` ${running.progress}%` : ''} · ${elapsedText(running.createdAt, now)}`
                          : queued
                            ? `排队中 · ${elapsedText(activeShot?.createdAt ?? now, now)}`
                            : '空闲'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        className="btn btn-primary h-8 px-2 text-xs"
                        onClick={() => openProject(p.id)}
                      >
                        <FolderOpen size={14} />
                        打开
                      </button>
                      <button className="btn h-8 px-2 text-xs" onClick={() => copy(p)}>
                        <Copy size={14} />
                        复制
                      </button>
                      <button
                        className="btn h-8 px-2 text-xs text-err hover:bg-err/5"
                        onClick={() => setConfirmId(p.id)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>

                    {activeShot && (
                      <JobProgress
                        state={activeShot.state}
                        progress={activeShot.progress}
                        className="-mx-4 -mb-4 rounded-none rounded-b-2xl"
                      />
                    )}
                  </article>
                )
              })}
              </div>
            </div>
          )}
        </div>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}

      {editing && <NewProjectDialog project={editing} onClose={() => setEditId(null)} />}

      {confirmId && (
        <Modal
          title="删除项目"
          onClose={() => setConfirmId(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmId(null)}>
                取消
              </button>
              <button
                className="btn border-err/30 bg-err/5 text-err hover:bg-err/10"
                onClick={() => {
                  deleteProject(confirmId)
                  setConfirmId(null)
                  toast('项目已删除', 'err')
                }}
              >
                删除
              </button>
            </>
          }
        >
          <p>删除后该项目下的所有视频记录都会移除，不可恢复。</p>
        </Modal>
      )}
    </div>
  )
}
