import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, Check, Info, TriangleAlert, X } from 'lucide-react'
import { useToasts, type ToastType } from '../../store/toast'
import { cn } from '../../lib/utils'

const meta: Record<ToastType, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: 'border-acc/30 text-acc2' },
  success: { icon: Check, cls: 'border-ok/30 text-ok' },
  warn: { icon: TriangleAlert, cls: 'border-warn/30 text-warn' },
  error: { icon: CircleAlert, cls: 'border-err/30 text-err' },
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[340px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const { icon: Icon, cls } = meta[t.type]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-canvas/95 p-3.5 text-sm shadow-lift backdrop-blur',
                cls,
              )}
            >
              <Icon size={17} className="mt-0.5 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-words text-ink">
                {t.text}
              </span>
              <button
                className="text-dim transition hover:text-ink"
                onClick={() => dismiss(t.id)}
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
