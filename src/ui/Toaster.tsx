import { CircleAlert, Check, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { cn } from '@/lib/utils'

export function Toaster() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === 'err' ? CircleAlert : Check
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-rise items-start gap-2.5 rounded-xl border border-line bg-canvas p-3.5 text-sm shadow-lift"
          >
            <Icon
              size={16}
              className={cn('mt-0.5 shrink-0', t.kind === 'err' ? 'text-err' : 'text-ok')}
            />
            <span className="flex-1 whitespace-pre-wrap break-words text-ink">{t.text}</span>
            <button
              className="text-dim transition hover:text-ink"
              onClick={() => dismiss(t.id)}
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
