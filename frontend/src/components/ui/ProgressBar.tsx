import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export function ProgressBar({
  value,
  indeterminate,
  className,
}: {
  value: number
  indeterminate?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'mt-2.5 h-2 overflow-hidden rounded-full border border-line bg-soft',
        className,
      )}
    >
      {indeterminate ? (
        <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-transparent via-acc to-transparent bg-[length:200%_100%]" />
      ) : (
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-acc2 to-acc"
          initial={false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      )}
    </div>
  )
}
