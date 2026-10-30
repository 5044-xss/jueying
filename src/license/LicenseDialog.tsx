import { useState } from 'react'
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { ActivationForm } from './ActivationForm'
import { formatDateTime, statusLabel } from './format'
import { useLicense } from './store'

export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const state = useLicense((s) => s.state)
  const reset = useLicense((s) => s.reset)
  const checking = useLicense((s) => s.checking)
  const toast = useApp((s) => s.toast)
  const [confirmReset, setConfirmReset] = useState(false)

  const tone = state.allowed
    ? 'bg-ok/10 text-ok'
    : state.status === 'pending'
      ? 'bg-warn/10 text-warn'
      : 'bg-err/10 text-err'

  const clear = async () => {
    await reset()
    setConfirmReset(false)
    toast('已清除本地授权')
  }

  return (
    <Modal title="授权" onClose={onClose} wide>
      <div className="rounded-xl border border-line bg-soft/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck size={16} className="text-dim" />
          <span className="text-sm font-medium text-ink">{statusLabel(state.status, state.phase)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone}`}>
            {state.offline ? '离线' : '在线'}
          </span>
          <span className="ml-auto text-[11px] text-dim">
            {state.checkedAt ? `检查于 ${formatDateTime(state.checkedAt)}` : '尚未检查'}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-dim">{state.message}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
          {state.sn && (
            <span>
              授权编号 <span className="font-mono text-ink">{state.sn}</span>
            </span>
          )}
          {state.nbf && <span>生效 {formatDateTime(state.nbf)}</span>}
          {state.exp && <span>到期 {formatDateTime(state.exp)}</span>}
          {!state.exp && state.status === 'active' && <span>永久授权</span>}
        </div>
        {state.error && <p className="mt-2 break-words text-[11px] text-err">{state.error}</p>}
      </div>

      <div className="border-t border-line pt-4">
        <ActivationForm />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {confirmReset ? (
          <>
            <span className="text-[11px] text-dim">清除后需要重新输入激活码，确定吗？</span>
            <button className="btn px-3 py-1.5 text-xs text-err" onClick={() => void clear()}>
              {checking ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              确认清除
            </button>
            <button
              className="btn btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setConfirmReset(false)}
            >
              取消
            </button>
          </>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 text-[11px] text-dim transition hover:text-err"
            onClick={() => setConfirmReset(true)}
          >
            <Trash2 size={12} />
            清除本地授权
          </button>
        )}
      </div>
    </Modal>
  )
}
