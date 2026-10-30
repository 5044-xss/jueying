import { useState } from 'react'
import { Check, Copy, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { useApp } from '@/store/app'
import { cn } from '@/lib/utils'
import { useLicense } from './store'

export function ActivationForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const state = useLicense((s) => s.state)
  const activate = useLicense((s) => s.activate)
  const refresh = useLicense((s) => s.refresh)
  const checking = useLicense((s) => s.checking)
  const activating = useLicense((s) => s.activating)
  const toast = useApp((s) => s.toast)

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyMachine = async () => {
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

  const submit = async () => {
    const value = code.trim()
    if (!value) {
      setError('请先粘贴激活码')
      return
    }
    setError(null)
    const result = await activate(value)
    if (!result.ok) {
      setError(result.error || '激活失败')
      return
    }
    setCode('')
    toast('激活码已保存')
  }

  const check = async () => {
    setError(null)
    await refresh()
    const next = useLicense.getState().state
    if (next.status === 'error') {
      toast(next.error || next.message, 'err')
    } else {
      toast('授权状态已刷新')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="label">本机机器码</span>
        <div className="flex gap-2">
          <code className="flex min-w-0 flex-1 items-center truncate rounded-lg border border-line bg-soft px-3.5 py-2.5 font-mono text-sm tracking-[0.08em] text-ink">
            {state.machineDisplay || '获取中…'}
          </code>
          <button
            className="btn shrink-0 px-3"
            onClick={() => void copyMachine()}
            disabled={!state.machineDisplay}
            title="复制机器码"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
          把机器码发送给卖家获取激活码。一码一机，更换硬件后需要重新签发。
        </p>
      </div>

      <div>
        <span className="label">激活码</span>
        <textarea
          autoFocus={autoFocus}
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError(null)
          }}
          placeholder="粘贴激活码…"
          maxLength={8000}
          spellCheck={false}
          className="input min-h-[92px] resize-y break-all font-mono text-xs leading-relaxed"
        />
        {state.status === 'active' && (
          <p className="mt-1.5 text-[11px] text-dim">
            当前已授权。如需更换授权，直接粘贴新的激活码即可。
          </p>
        )}
      </div>

      {error && <p className="text-xs text-err">{error}</p>}
      {!error && state.warning && <p className="text-xs text-warn">{state.warning}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary px-5"
          onClick={() => void submit()}
          disabled={activating || !code.trim()}
        >
          {activating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <KeyRound size={14} />
          )}
          {activating ? '激活中…' : '激活'}
        </button>
        <button className="btn" onClick={() => void check()} disabled={checking}>
          <RefreshCw size={14} className={cn(checking && 'animate-spin')} />
          {checking ? '检查中…' : '检查授权'}
        </button>
      </div>
    </div>
  )
}
