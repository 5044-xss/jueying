import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface TabItem<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T
  onChange: (v: T) => void
  items: TabItem<T>[]
}) {
  return (
    <div className="inline-flex rounded-full border border-line bg-soft p-1">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition',
            value === it.value
              ? 'bg-ink text-white'
              : 'text-dim hover:text-ink',
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}
