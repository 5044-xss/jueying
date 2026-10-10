import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Select<T extends string>({
  icon,
  value,
  options,
  onChange,
  className,
}: {
  icon?: ReactNode
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-2.5 text-xs font-medium backdrop-blur transition',
          open
            ? 'border-ink/30 bg-soft text-ink'
            : 'border-line bg-canvas/70 text-ink hover:border-ink/25',
        )}
      >
        {icon && <span className="text-dim">{icon}</span>}
        <span>{current?.label ?? value}</span>
        <ChevronDown
          size={13}
          className={cn('text-dim transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-[7rem] rounded-2xl border border-line bg-canvas p-1.5 shadow-lift">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-left text-xs transition',
                o.value === value
                  ? 'bg-soft font-semibold text-ink'
                  : 'text-dim hover:bg-soft hover:text-ink',
              )}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check size={13} className="text-acc" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
