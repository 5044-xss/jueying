import type { ReactNode } from 'react'
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
  return (
    <span className={cn('group/tip relative inline-flex items-center gap-1', className)}>
      {children}
      <span className="pointer-events-none absolute left-0 top-full z-40 mt-2 hidden w-60 rounded-xl border border-line bg-canvas p-2.5 text-left text-xs font-normal leading-relaxed text-dim shadow-lift group-hover/tip:block">
        {text}
      </span>
    </span>
  )
}
