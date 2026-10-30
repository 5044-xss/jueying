import { useState } from 'react'
import { Check, Copy, ShieldCheck } from 'lucide-react'
import { useApp } from '@/store/app'
import { formatDateTime, statusLabel } from './format'
import { useLicense } from './store'

export function LicenseSettings({ onManage }: { onManage: () => void }) {
  const state = useLicense((s) => s.state)
  const toast = useApp((s) => s.toast)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!state.machineDisplay) return
    try {
      await navigator.clipboard.writeText(state.machineDisplay)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast('已复制机器码')
    } catch {
      toast('复制失败，请手动选择复制', 'err')
    }
  }

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-dim" />
        <span className="section-title">授权</span>
        <span className="ml-auto text-[11px] text-dim">{statusLabel(state.status, state.phase)}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <code className="flex min-w-0 flex-1 items-center truncate rounded-lg border border-line bg-soft px-3 py-2 font-mono text-[11.5px] tracking-[0.08em] text-ink">
          {state.machineDisplay || '获取中…'}
        </code>
        <button
          className="btn shrink-0 px-2.5 py-1.5"
          onClick={() => void copy()}
          disabled={!state.machineDisplay}
          title="复制机器码"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
        <span>{state.message}</span>
        {state.exp && <span>到期 {formatDateTime(state.exp)}</span>}
        {!state.exp && state.status === 'active' && <span>永久授权</span>}
      </div>

      <button className="btn mt-3 w-full py-2 text-xs" onClick={onManage}>
        管理授权
      </button>
    </div>
  )
}
