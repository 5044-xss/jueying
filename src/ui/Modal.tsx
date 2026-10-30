import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className={cn(
          'max-h-[86dvh] w-full animate-rise overflow-y-auto rounded-[24px] border border-line bg-canvas p-6 shadow-lift',
          wide ? 'max-w-2xl' : 'max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h3 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
          <button
            className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-soft text-ink transition hover:bg-line/70"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4 text-sm text-dim">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
