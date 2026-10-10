import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'default' | 'ok' | 'warn' | 'err' | 'acc'

const tones: Record<Tone, string> = {
  default: 'border-line bg-soft text-dim',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  err: 'border-err/30 bg-err/10 text-err',
  acc: 'border-acc/30 bg-acc/10 text-acc2',
}

export function Badge({
  tone = 'default',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
