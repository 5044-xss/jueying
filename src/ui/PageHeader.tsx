import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const ACCENTS = {
  lilac: 'bg-lilac',
  lime: 'bg-lime',
  cream: 'bg-cream',
  mint: 'bg-mint',
  pink: 'bg-pink',
  coral: 'bg-coral',
  aqua: 'bg-aqua',
} as const

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  accent = 'lilac',
  block,
}: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  accent?: keyof typeof ACCENTS
  block?: keyof typeof ACCENTS
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-4',
        block && cn('rounded-[28px] px-5 py-5 sm:px-6', ACCENTS[block]),
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', ACCENTS[accent])} />
          <span
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.16em]',
              block ? 'text-ink/55' : 'text-dim',
            )}
          >
            {eyebrow}
          </span>
        </div>
        <h1 className="text-2xl font-light tracking-[-0.5px]">{title}</h1>
        {description && (
          <div
            className={cn(
              'max-w-2xl text-sm leading-relaxed',
              block ? 'text-ink/60' : 'text-dim',
            )}
          >
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
