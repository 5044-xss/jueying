import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useHealth, useSettings } from '../api/queries'
import { Badge } from './ui/Badge'
import { Spinner } from './ui/Spinner'

export function ConnectionBadge() {
  const { data, isLoading, isError } = useHealth()
  const { data: settings } = useSettings()
  const cloud = settings?.cloud
  const name =
    cloud?.name || (cloud?.type === 'autodl' ? 'AutoDL' : '仙宫云')

  if (isLoading) {
    return (
      <Badge>
        <Spinner className="h-3 w-3" /> 连接中…
      </Badge>
    )
  }
  if (isError || !data?.ok) {
    return (
      <Badge tone="err">
        <CircleAlert size={12} /> 后端服务不可达
      </Badge>
    )
  }
  if (!data.configured) {
    return (
      <Badge tone="warn">
        <TriangleAlert size={12} /> 未配置云端地址
      </Badge>
    )
  }
  return (
    <Badge tone="ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_8px_rgb(var(--ok))]" />
      {name} · 已配置
    </Badge>
  )
}
