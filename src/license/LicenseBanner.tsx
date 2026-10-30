import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import { useNow } from '@/lib/useNow'
import { trialRemainingText } from './format'
import { LicenseDialog } from './LicenseDialog'
import { useLicense } from './store'

export function LicenseBanner() {
  const state = useLicense((s) => s.state)
  const [open, setOpen] = useState(false)
  const trial = state.status === 'trial'
  const now = useNow(trial, 60_000)

  if (!trial) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-cream px-4 py-2 text-xs text-ink/75">
        <Clock3 size={14} className="shrink-0" />
        <span>{trialRemainingText(state, now)}</span>
        {state.offline && <span className="text-dim">（离线缓存）</span>}
        <button
          className="btn ml-auto shrink-0 px-3 py-1 text-[11px]"
          onClick={() => setOpen(true)}
        >
          激活正式版
        </button>
      </div>
      {open && <LicenseDialog onClose={() => setOpen(false)} />}
    </>
  )
}
