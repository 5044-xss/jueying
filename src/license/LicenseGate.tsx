import { useEffect, type ReactNode } from 'react'
import { Loader2, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActivationForm } from './ActivationForm'
import { formatDateTime } from './format'
import { useLicense } from './store'
import type { LicenseState } from './types'

function LoadingScreen({ state }: { state: LicenseState }) {
  return (
    <div className="grid h-full place-items-center bg-soft px-6">
      <div className="flex flex-col items-center gap-3 text-sm text-dim">
        <Loader2 size={20} className="animate-spin" />
        <div>{state.message || '正在校验授权…'}</div>
        {state.machineDisplay && (
          <code className="rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-[11px] tracking-[0.08em]">
            {state.machineDisplay}
          </code>
        )}
      </div>
    </div>
  )
}

function descriptionOf(state: LicenseState): string {
  if (state.status === 'pending') {
    return `授权将于 ${formatDateTime(state.nbf)} 生效，到时间后点击“检查授权”即可。`
  }
  if (state.status === 'expired') {
    return '授权或试用已结束。续期后点击“检查授权”即可恢复使用。'
  }
  if (state.status === 'revoked') {
    return '该授权已被吊销，本地授权状态已清除。请联系卖家处理。'
  }
  if (state.status === 'invalid') {
    return state.message || '激活码无效，请确认激活码与当前机器码匹配。'
  }
  if (state.status === 'error') {
    return '暂时无法连接授权服务器。已有付费授权的用户可在断网宽限期内继续使用，否则请检查网络后重试。'
  }
  return '本机尚未授权。请将机器码发送给卖家获取激活码，或申请试用。'
}

function Callout({ state }: { state: LicenseState }) {
  const pending = state.status === 'pending'
  const failed = state.status === 'error'
  const active = state.status === 'active' || state.status === 'trial'
  const Icon = active ? ShieldCheck : failed ? WifiOff : ShieldAlert

  return (
    <div
      className={cn(
        'mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
        active && 'border-ok/20 bg-ok/5 text-ok',
        pending && 'border-warn/25 bg-warn/5 text-warn',
        failed && 'border-line bg-soft text-dim',
        !active && !pending && !failed && 'border-err/20 bg-err/5 text-err',
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words text-ink">{state.message || '未知授权状态'}</div>
        {state.error && state.error !== state.message && !state.error.startsWith(state.message) && (
          <div className="mt-1 break-words font-mono text-[10.5px] text-dim">{state.error}</div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-dim">
          {state.status === 'pending' && state.nbf && (
            <span>生效时间 {formatDateTime(state.nbf)}</span>
          )}
          {state.exp && <span>到期时间 {formatDateTime(state.exp)}</span>}
          {state.sn && <span className="font-mono">{state.sn}</span>}
          {state.offline && <span>离线校验</span>}
        </div>
      </div>
    </div>
  )
}

export function ActivationScreen({ state }: { state: LicenseState }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-soft">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-ink text-base font-bold text-canvas">
            掘
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">掘影</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              License Activation
            </div>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <span className="section-title">Authorization</span>
          <h1 className="mt-2 text-2xl font-light tracking-tight">激活掘影</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-dim">{descriptionOf(state)}</p>

          <Callout state={state} />

          <div className="mt-6 border-t border-line pt-6">
            <ActivationForm autoFocus />
          </div>

          <p className="mt-6 border-t border-line pt-4 text-[11px] leading-relaxed text-dim">
            授权与机器码绑定，一码一机。更换硬件后请联系卖家重新签发，客户端不提供自助换绑。
          </p>
        </div>
      </div>
    </div>
  )
}

export function LicenseGate({ children }: { children: ReactNode }) {
  const state = useLicense((s) => s.state)
  const init = useLicense((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (state.phase === 'loading' || (!state.status && state.phase !== 'error')) {
    return <LoadingScreen state={state} />
  }

  if (!state.allowed) return <ActivationScreen state={state} />

  return <>{children}</>
}
