import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export function Select<T extends string>({
  icon,
  value,
  options,
  onChange,
  className,
  placeholder,
}: {
  icon?: ReactNode
  value: T | ''
  options: SelectOption<T>[]
  onChange: (v: T) => void
  className?: string
  placeholder?: string
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
          'inline-flex max-w-[240px] items-center gap-1.5 rounded-full border py-1 pl-3 pr-2.5 text-xs font-medium transition',
          open
            ? 'border-ink/40 bg-soft text-ink'
            : 'border-line bg-canvas text-ink hover:bg-soft',
        )}
      >
        {icon && <span className="shrink-0 text-dim">{icon}</span>}
        <span className="truncate">{current?.label ?? placeholder ?? value}</span>
        <ChevronDown size={13} className={cn('shrink-0 text-dim transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 max-h-52 min-w-full overflow-y-auto rounded-xl border border-line bg-canvas p-1 shadow-lift">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                if (o.disabled) return
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-xs transition',
                o.disabled
                  ? 'cursor-not-allowed text-dim/40'
                  : o.value === value
                    ? 'bg-soft font-medium text-ink'
                    : 'text-dim hover:bg-soft hover:text-ink',
              )}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && !o.disabled && <Check size={13} className="text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
