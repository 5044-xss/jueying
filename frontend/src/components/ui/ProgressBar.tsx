import { motion } from 'framer-motion'

export function ProgressBar({
  value,
  indeterminate,
}: {
  value: number
  indeterminate?: boolean
}) {
  return (
    <div className="mt-2.5 h-2 overflow-hidden rounded-full border border-line bg-soft">
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
