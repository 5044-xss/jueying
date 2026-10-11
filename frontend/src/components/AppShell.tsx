import { Clock, Settings, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { useUI, type View } from '../store/ui'
import { ConnectionBadge } from './ConnectionBadge'

const nav: { value: View; label: string; icon: ReactNode }[] = [
  { value: 'generator', label: '生成台', icon: <Sparkles size={17} /> },
  { value: 'history', label: '记录', icon: <Clock size={17} /> },
  { value: 'settings', label: '设置', icon: <Settings size={17} /> },
]

export function AppShell({ children }: { children: ReactNode }) {
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)

  return (
    <div className="flex h-full">
      {/* 左侧悬浮导航轨道 */}
      <div className="drag-region relative w-[72px] shrink-0">
        <div className="drag-region fixed left-4 top-3 z-40 flex items-center gap-2.5">
          <div className="h-8 w-8 overflow-hidden rounded-xl bg-ink">
            <img src="app-icon.png" alt="掘影" className="h-8 w-8 object-cover" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">掘影</div>
            <div className="text-[11px] text-dim">视频生成工作台</div>
          </div>
        </div>

        <nav className="no-drag fixed left-4 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1 rounded-full border border-line bg-canvas/85 p-1.5 shadow-lift backdrop-blur">
          {nav.map((it) => (
            <button
              key={it.value}
              onClick={() => setView(it.value)}
              title={it.label}
              aria-label={it.label}
              className={cn(
                'grid h-10 w-10 place-items-center rounded-full transition',
                view === it.value
                  ? 'bg-ink text-white'
                  : 'text-dim hover:bg-soft hover:text-ink',
              )}
            >
              {it.icon}
            </button>
          ))}
        </nav>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="no-drag fixed right-4 top-3 z-40">
          <ConnectionBadge />
        </div>
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-10 pt-16 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
