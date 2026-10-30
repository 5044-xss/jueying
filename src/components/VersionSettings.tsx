import { useEffect, useState } from 'react'
import { ExternalLink, Package } from 'lucide-react'

export const DOWNLOAD_URL =
  'https://my.feishu.cn/drive/folder/QOcnfK8Qplz3UednW7scAqUOngd?from=space_personal_filelist'

export function VersionSettings() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    let alive = true
    const bridge = window.desktop

    if (!bridge) {
      setVersion(__APP_VERSION__)
      return
    }

    void bridge
      .version()
      .then((value) => {
        if (alive) setVersion(value)
      })
      .catch(() => {
        if (alive) setVersion(__APP_VERSION__)
      })

    return () => {
      alive = false
    }
  }, [])

  const openDownload = () => {
    window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <Package size={14} className="text-dim" />
        <span className="section-title">版本更新</span>
        <span className="ml-auto font-mono text-[11px] text-dim">v{version || '—'}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-dim">
          暂不支持应用内更新，请前往下载页获取最新安装包。
        </p>
        <button className="btn shrink-0 px-3 py-1.5 text-xs" onClick={openDownload}>
          <ExternalLink size={13} />
          前往下载
        </button>
      </div>
    </div>
  )
}
