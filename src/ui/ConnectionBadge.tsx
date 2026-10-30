import { CircleAlert, TriangleAlert } from 'lucide-react'
import { activeEndpoint, useApp } from '@/store/app'
import { cn } from '@/lib/utils'

export function ConnectionBadge() {
  const endpoint = useApp(activeEndpoint)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  return (
    <button
      onClick={() => setSettingsOpen(true)}
      title={endpoint ? endpoint.url : '配置生成端地址'}
      className={cn(
        'inline-flex max-w-[46vw] items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition sm:max-w-none sm:text-xs',
        endpoint
          ? 'border-line text-ink hover:bg-soft'
          : 'border-warn/30 text-warn hover:bg-warn/5',
      )}
    >
      {endpoint ? (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
          <span className="truncate">{endpoint.name} · 已配置</span>
        </>
      ) : (
        <>
          <TriangleAlert size={12} className="shrink-0" />
          未配置生成端
        </>
      )}
    </button>
  )
}

export function ErrorBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-err/30 bg-err/5 px-3 py-1.5 text-xs font-medium text-err">
      <CircleAlert size={12} /> 连接失败
    </span>
  )
}
