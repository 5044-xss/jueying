import { useEffect, useState } from 'react'
import { Loader2, Wifi } from 'lucide-react'
import { ComfyClient } from '@/core/comfy'
import { LicenseDialog } from '@/license/LicenseDialog'
import { LicenseSettings } from '@/license/LicenseSettings'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'
import { VersionSettings } from './VersionSettings'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || '生成端'
  }
}

export function SettingsDialog() {
  const close = () => useApp.getState().setSettingsOpen(false)
  const savedUrl = useApp((s) => s.data.endpoints[0]?.url ?? '')
  const addEndpoint = useApp((s) => s.addEndpoint)
  const touchEndpoint = useApp((s) => s.touchEndpoint)
  const toast = useApp((s) => s.toast)

  const [url, setUrl] = useState(savedUrl)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataPath, setDataPath] = useState('')
  const [licenseOpen, setLicenseOpen] = useState(false)

  useEffect(() => {
    void window.desktop?.dataPath?.().then(setDataPath)
  }, [])

  const connect = async () => {
    const value = url.trim()
    if (!value) {
      setError('先粘贴生成端地址')
      return
    }
    const normalized = value.replace(/\/+$/, '')
    setTesting(true)
    setError(null)

    const endpoint = addEndpoint(hostOf(value), normalized)

    const result = await new ComfyClient(endpoint.url).test()
    setTesting(false)

    if (!result.ok) {
      setError(result.detail)
      toast(result.detail, 'err')
      return
    }

    touchEndpoint(endpoint.id)
    setUrl(endpoint.url)
    const gpu = result.stats?.devices[0]
    toast(gpu ? `连接成功 · ${gpu.name.replace(/^cuda:\d+\s*/, '')}` : '连接成功')
  }

  return (
    <Modal title="连接生成端" onClose={close} wide>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
            placeholder="https://xxxx-8188.container.x-gpu.com/"
            className="input min-w-0 flex-1 py-2 font-mono text-xs"
          />
          <button
            className="btn btn-primary flex-none px-4"
            onClick={() => void connect()}
            disabled={testing}
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
            {testing ? '测试中…' : '连接并测试'}
          </button>
        </div>
        {error ? (
          <p className="text-xs text-err">{error}</p>
        ) : (
          <p className="text-[11px] text-dim">
            测试通过后会自动替换当前地址，只保留这一个生成端。
          </p>
        )}
      </div>

      {window.desktop?.license && (
        <LicenseSettings onManage={() => setLicenseOpen(true)} />
      )}

      {dataPath && (
        <p className="border-t border-line pt-3 font-mono text-[10px] leading-relaxed text-dim">
          本地数据：{dataPath}
        </p>
      )}

      <VersionSettings />

      {licenseOpen && <LicenseDialog onClose={() => setLicenseOpen(false)} />}
    </Modal>
  )
}
