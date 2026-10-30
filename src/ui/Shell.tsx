import type { ReactNode } from 'react'
import { Folder, Library, Settings, Sparkles } from 'lucide-react'
import { useApp, type Tab } from '@/store/app'
import { cn } from '@/lib/utils'

const NAV: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: 'gen', label: '生成台', icon: Sparkles },
  { key: 'projects', label: '我的项目', icon: Folder },
  { key: 'library', label: '资产库', icon: Library },
]

export function Shell({ children }: { children: ReactNode }) {
  const tab = useApp((s) => s.tab)
  const setTab = useApp((s) => s.setTab)
  const projectId = useApp((s) => s.projectId)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const activeCount = useApp((s) =>
    s.data.projects.reduce(
      (n, p) =>
        n + p.shots.filter((x) => x.state === 'queued' || x.state === 'running').length,
      0,
    ),
  )

  return (
    <div className="grid h-full min-h-0 overflow-hidden md:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-line bg-soft md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-[13px] font-bold text-canvas">
            掘
          </div>
          <span className="text-[15px] font-semibold tracking-tight">掘影</span>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            Workspace
          </div>
          <nav className="flex flex-col gap-1 text-sm">
            {NAV.map(({ key, label, icon: Icon }) => {
              const active = tab === key && !projectId
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 font-medium transition-colors',
                    active
                      ? 'bg-ink text-canvas'
                      : 'text-dim hover:bg-canvas hover:text-ink',
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  {label}
                  {key === 'gen' && activeCount > 0 && (
                    <span
                      className={cn(
                        'ml-auto font-mono text-[10.5px]',
                        active ? 'text-canvas/80' : 'text-ink',
                      )}
                    >
                      {activeCount}
                    </span>
                  )}
                  {key === 'projects' && <Count active={active} />}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="shrink-0 border-t border-line p-3">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-dim transition-colors hover:bg-canvas hover:text-ink"
          >
            <Settings size={16} className="shrink-0" />
            设置
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-6 md:px-6 md:pb-10 2xl:px-8">
          <div className="min-h-full w-full md:h-full">{children}</div>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1.5 border-t border-line bg-canvas px-3 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 md:hidden">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = tab === key && !projectId
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'grid flex-1 justify-items-center gap-0.5 rounded-full px-1 py-1.5 text-[10.5px]',
                active ? 'bg-ink text-canvas' : 'text-dim',
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          )
        })}
        <button
          onClick={() => setSettingsOpen(true)}
          className="grid flex-1 justify-items-center gap-0.5 rounded-full px-1 py-1.5 text-[10.5px] text-dim"
        >
          <Settings size={18} />
          设置
        </button>
      </nav>

    </div>
  )
}

function Count({ active }: { active: boolean }) {
  const n = useApp((s) => s.data.projects.length)
  if (!n) return null
  return (
    <span
      className={cn(
        'ml-auto font-mono text-[10.5px]',
        active ? 'text-canvas/70' : 'text-dim',
      )}
    >
      {n}
    </span>
  )
}
