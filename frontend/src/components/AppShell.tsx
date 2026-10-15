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
    <div className="flex h-full flex-col">
      {/* 顶部导航栏：左 logo / 中导航 / 右状态，背景极淡渐隐，避免硬分层 */}
      <header className="drag-region relative grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/45 to-transparent"
        />

        <div className="relative flex items-center gap-2.5 justify-self-start">
          <div className="h-8 w-8 overflow-hidden rounded-xl bg-ink">
            <img src="app-icon.png" alt="掘影" className="h-8 w-8 object-cover" />
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-bold tracking-tight">掘影</div>
            <div className="text-[11px] text-dim">视频生成工作台</div>
          </div>
        </div>

        <nav className="no-drag relative flex items-center gap-1 justify-self-center rounded-full border border-line bg-canvas/85 p-1 shadow-lift">
          {nav.map((it) => (
            <button
              key={it.value}
              onClick={() => setView(it.value)}
              title={it.label}
              aria-label={it.label}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                view === it.value
                  ? 'bg-ink text-white'
                  : 'text-dim hover:bg-soft hover:text-ink',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </nav>

        <div className="no-drag relative justify-self-end">
          <ConnectionBadge />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-10 pt-5 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
