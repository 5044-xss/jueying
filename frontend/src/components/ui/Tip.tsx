import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

export function Tip({
  text,
  children,
  className,
}: {
  text: ReactNode
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 240
    const left = Math.min(
      Math.max(8, r.left),
      Math.max(8, window.innerWidth - width - 8),
    )
    setPos({ left, top: r.bottom + 6 })
  }
  const hide = () => setPos(null)

  useEffect(() => {
    if (!pos) return
    const onScroll = () => hide()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pos])

  return (
    <span
      ref={ref}
      className={cn('group/tip relative inline-flex items-center gap-1', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            style={{ left: pos.left, top: pos.top, width: 240 }}
            className="pointer-events-none fixed z-[9999] rounded-xl border border-line bg-canvas p-2.5 text-left text-xs font-normal leading-relaxed text-dim shadow-lift"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
