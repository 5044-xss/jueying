import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />
}

type Tone = 'soft' | 'lime' | 'mint' | 'cream' | 'lilac' | 'pink' | 'coral' | 'navy'

const blockTone: Record<Tone, string> = {
  soft: 'bg-soft text-ink',
  lime: 'bg-lime/70 text-ink',
  mint: 'bg-mint/80 text-ink',
  cream: 'bg-cream text-ink',
  lilac: 'bg-lilac/60 text-ink',
  pink: 'bg-pink/70 text-ink',
  coral: 'bg-coral/60 text-ink',
  navy: 'bg-navy text-white',
}

export function CardTitle({
  icon,
  children,
  right,
  tone = 'soft',
}: {
  icon?: ReactNode
  children: ReactNode
  right?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {icon && (
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-xl',
            blockTone[tone],
          )}
        >
          {icon}
        </span>
      )}
      <h2 className="section-title">{children}</h2>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  )
}
