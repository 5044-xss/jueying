import { CheckCircle2, ChevronDown, Copy, Download, HelpCircle, RefreshCw, Server, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { useCatalog, useSaveSettings, useSettings, useTestCloud } from '../api/queries'
import type { Catalog, Settings, TestResult } from '../api/types'
import type { CheckUpdateResult, UpdateStatus } from '../global'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { Spinner } from '../components/ui/Spinner'
import { Tip } from '../components/ui/Tip'
import { cn } from '../lib/utils'
import { toast } from '../store/toast'

const cloudSchema = z
  .object({
    type: z.string(),
    base_url: z.string().optional(),
    ssh_host: z.string().optional(),
  })
  .refine((v) => (v.type === 'xgpu' ? !!v.base_url?.trim() : !!v.ssh_host?.trim()), {
    message: '请填写实例地址 base_url',
  })

function FieldLabel({ text, tip }: { text: string; tip: ReactNode }) {
  return (
    <div className="label flex items-center gap-1">
      <span>{text}</span>
      <Tip text={tip}>
        <HelpCircle size={12} className="cursor-help text-dim/70" />
      </Tip>
    </div>
  )
}

function CatalogSummary({ catalog }: { catalog: Catalog }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Badge tone="acc">节点 {catalog.nodes.length}</Badge>
        <Badge tone={catalog.has_xb_resolution ? 'ok' : 'warn'}>
          XB 分辨率节点 {catalog.has_xb_resolution ? '有' : '无'}
        </Badge>
        <Badge tone={catalog.has_savevideo ? 'ok' : 'warn'}>
          SaveVideo {catalog.has_savevideo ? '有' : '无'}
        </Badge>
        <Badge tone={catalog.has_vhs ? 'ok' : 'warn'}>
          VHS {catalog.has_vhs ? '有' : '无'}
        </Badge>
      </div>
      <div className="text-xs text-dim/80">
        unet {(catalog.files.unet || []).length} · clip{' '}
        {(catalog.files.clip || []).length} · lora{' '}
        {(catalog.files.lora || []).length} · vae{' '}
        {(catalog.files.vae || []).length}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { data, isLoading, isError, error } = useSettings()
  const saveSettings = useSaveSettings()
  const testCloud = useTestCloud()
  const catalogQuery = useCatalog()

  const [form, setForm] = useState<Settings | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [secondOpen, setSecondOpen] = useState(false)
  const [machine, setMachine] = useState<{ code: string; display: string } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const isDesktop = typeof window !== 'undefined' && !!window.licenseAPI
  const lastSavedRef = useRef('')

  useEffect(() => {
    const off = window.jueman?.onUpdateStatus?.((s) => {
      setUpdateStatus(s)
      if (s.phase === 'error') {
        setUpdating(false)
        toast.error(`更新失败：${s.message ?? '未知错误'}`)
      } else if (s.phase === 'downloading' || s.phase === 'downloaded') {
        setUpdating(true)
      }
    })
    return () => {
      off?.()
    }
  }, [])

  useEffect(() => {
    if (!window.licenseAPI) return
    window.licenseAPI
      .getMachineId()
      .then(setMachine)
      .catch(() => undefined)
    window.jueman?.info?.().then((i) => setAppVersion(i.version)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (data && !form) setForm(structuredClone(data))
  }, [data, form])

  // 改动即自动保存（防抖 800ms），不再需要「保存配置」按钮。
  useEffect(() => {
    if (!form) return
    const payload = JSON.stringify({
      cloud: form.cloud,
      gen: form.gen,
      models: form.models,
    })
    if (lastSavedRef.current === '') {
      lastSavedRef.current = payload
      return
    }
    if (payload === lastSavedRef.current) return
    const t = window.setTimeout(() => {
      saveSettings.mutate(
        { cloud: form.cloud, gen: form.gen, models: form.models },
        {
          onSuccess: () => {
            lastSavedRef.current = payload
          },
          onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
        },
      )
    }, 800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  function copyMachineCode() {
    if (!machine) return
    navigator.clipboard.writeText(machine.display)
    toast.success('已复制机器码')
  }

  async function reactivate() {
    if (!window.licenseAPI) return
    try {
      await window.licenseAPI.resetLicense()
    } catch {
      /* 主界面会被关闭，忽略中断 */
    }
  }

  async function checkUpdate() {
    if (!window.jueman?.checkUpdate) return
    setChecking(true)
    setUpdateResult(null)
    try {
      const result = await window.jueman.checkUpdate()
      setUpdateResult(result)
      if (!result.ok) toast.error(`检查更新失败：${result.error ?? '未知错误'}`)
      else if (result.hasUpdate) toast.success(`发现新版本 ${result.latest}`)
      else toast.success(result.note ?? '已是最新版本')
    } catch {
      toast.error('检查更新失败')
    } finally {
      setChecking(false)
    }
  }

  async function startUpdate() {
    if (!window.jueman?.startUpdate) return
    setUpdating(true)
    setUpdateStatus({ phase: 'checking' })
    try {
      const r = await window.jueman.startUpdate()
      if (!r.ok) {
        setUpdating(false)
        toast.error(`更新失败：${r.error ?? '未知错误'}`)
      }
      // 成功后进入下载，进度/完成通过 onUpdateStatus 推送；下载完成会自动重启安装
    } catch (e) {
      setUpdating(false)
      toast.error(`更新失败：${(e as Error).message}`)
    }
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center gap-2 text-dim">
        <Spinner className="h-4 w-4" /> 读取配置…
      </div>
    )
  }
  if (isError) {
    return <div className="text-err">读取配置失败：{(error as Error).message}</div>
  }

  const cloud = form.cloud
  const patchCloud = (patch: Partial<Settings['cloud']>) =>
    setForm((f) => (f ? { ...f, cloud: { ...f.cloud, ...patch } } : f))
  const patchGen = (patch: Partial<Settings['gen']>) =>
    setForm((f) => (f ? { ...f, gen: { ...f.gen, ...patch } } : f))

  const catalog: Catalog | null =
    testResult?.catalog ?? catalogQuery.data ?? null

  async function onTest() {
    const parsed = cloudSchema.safeParse(cloud)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || '连接参数不完整')
      return
    }
    setBusy(true)
    setTestResult(null)
    try {
      const r = await testCloud.mutateAsync(cloud)
      setTestResult(r)
      if (r.ok) {
        toast.success(`连接正常：${r.detail || 'OK'}`)
      } else {
        toast.error(`连接失败：${r.detail || '未知错误'}`)
      }
    } catch (e) {
      toast.error(`连接失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function onLoadCatalog() {
    try {
      const r = await catalogQuery.refetch()
      if (r.data) toast.success('已加载云端模型列表')
    } catch (e) {
      toast.error(`加载失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      {/* 1. 云端连接 */}
      <Card>
        <CardTitle
          icon={<Server size={15} />}
          right={<Badge tone="default">仙宫云</Badge>}
        >
          云端连接
        </CardTitle>

        <div>
          <div className="label">实例地址 base_url</div>
          <input
            className="input"
            placeholder="https://<实例ID>-8188.container.x-gpu.com"
            value={cloud.base_url}
            onChange={(e) => patchCloud({ base_url: e.target.value })}
          />
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-dim">
          <input
            type="checkbox"
            className="accent-acc"
            checked={cloud.step_probe}
            onChange={(e) => patchCloud({ step_probe: e.target.checked })}
          />
          提交前探测实例节点与模型名（/object_info）
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={onTest} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Server size={14} />} 测试连接
          </Button>
          <Button onClick={onLoadCatalog} disabled={catalogQuery.isFetching}>
            <RefreshCw
              size={14}
              className={catalogQuery.isFetching ? 'animate-spin' : ''}
            />{' '}
            加载模型列表
          </Button>
        </div>

        {testResult && (
          <div
            className={`mt-3 rounded-2xl border px-3.5 py-2.5 text-xs ${
              testResult.ok
                ? 'border-ok/30 bg-ok/10 text-ok'
                : 'border-err/30 bg-err/10 text-err'
            }`}
          >
            {testResult.ok ? '连接正常：' : '连接失败：'}
            {testResult.detail || '未知'}
          </div>
        )}
        {catalog && (
          <div className="mt-3">
            <CatalogSummary catalog={catalog} />
          </div>
        )}
        <p className="mt-3 text-xs text-dim/60">改动会自动保存。</p>
      </Card>

      {/* 2. 参数配置 */}
      <Card>
        <CardTitle>参数配置</CardTitle>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel
              text="视频步数"
              tip="视频采样步数（默认 8）。越大越精细但越慢；配合官方 Turbo LoRA，8 步即可，一般无需调高。"
            />
            <input
              type="number"
              min={1}
              max={50}
              className="input"
              value={form.gen.video_steps}
              onChange={(e) =>
                patchGen({ video_steps: Number(e.target.value) || 8 })
              }
            />
          </div>
          <div>
            <FieldLabel
              text="音频步数"
              tip="音频采样步数（默认 8）。仅当集群装了多速率采样节点（MiniMaxH3MultiRateSamplerEXPT8）时才单独生效，否则与视频同步。"
            />
            <input
              type="number"
              min={1}
              max={50}
              className="input"
              value={form.gen.audio_steps}
              onChange={(e) =>
                patchGen({ audio_steps: Number(e.target.value) || 8 })
              }
            />
          </div>
          <div>
            <FieldLabel
              text="Sage 加速"
              tip="开=一直用 SageAttention 加速；关=完全不用（更稳但更慢，约 2.4×）。注意：13–15s + 768p 开 Sage 会崩，请配合下面的时长限制使用。"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
              <input
                type="checkbox"
                className="accent-acc"
                checked={form.gen.sage_enabled}
                onChange={(e) => patchGen({ sage_enabled: e.target.checked })}
              />
              {form.gen.sage_enabled ? '开启' : '关闭'}
            </label>
          </div>
        </div>

        <div className="my-4 border-t border-line/70" />
        <button
          type="button"
          onClick={() => setSecondOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 text-xs font-medium text-dim transition hover:text-ink"
        >
          <ChevronDown
            size={14}
            className={cn('transition', secondOpen && 'rotate-180')}
          />
          二采精修
          <span className="text-dim/60">
            {form.gen.second_pass ? '（已开启）' : '（可选）'}
          </span>
        </button>
        {secondOpen && (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <FieldLabel
                text="二采精修"
                tip="开启后对视频 latent 做二次采样精修（改善中远景面部/细节），耗时更长、显存占用更高。注意：24G 显存下配合 720P/768p 会 OOM，请用较低清晰度（≤0.5MP）。"
              />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
                <input
                  type="checkbox"
                  className="accent-acc"
                  checked={form.gen.second_pass}
                  onChange={(e) => patchGen({ second_pass: e.target.checked })}
                />
                {form.gen.second_pass ? '开启' : '关闭'}
              </label>
            </div>
            <div>
              <FieldLabel
                text="放大倍数（需二采）"
                tip="仅在“二采精修”开启时生效：二采 latent 的放大倍数（1.5≈1.5×）。越大越清晰但越慢；受原生上限约束，过大只会发虚。"
              />
              <input
                type="number"
                step="0.1"
                min={1}
                max={3}
                disabled={!form.gen.second_pass}
                className="input"
                value={form.gen.second_scale}
                onChange={(e) =>
                  patchGen({ second_scale: Number(e.target.value) || 1.5 })
                }
              />
            </div>
            <div>
              <FieldLabel
                text="二采重采样强度"
                tip="二采的重采样强度（0.1–1，默认 0.3）：越低越贴近一采结果，越高细节越多但过大易失真。"
              />
              <input
                type="number"
                step="0.05"
                min={0.1}
                max={1}
                disabled={!form.gen.second_pass}
                className="input"
                value={form.gen.second_denoise}
                onChange={(e) =>
                  patchGen({ second_denoise: Number(e.target.value) || 0.3 })
                }
              />
            </div>
          </div>
        )}
      </Card>

      {/* 3. 版本与授权 */}
      <Card>
        <CardTitle
          icon={<ShieldCheck size={15} />}
          right={
            <Badge tone={isDesktop ? 'ok' : 'default'}>
              {isDesktop ? '已激活' : '浏览器预览'}
            </Badge>
          }
        >
          版本与授权
        </CardTitle>
        {isDesktop ? (
          <>
            <div className="text-xs text-dim/80">当前版本 {appVersion || '—'}</div>
            <div className="mt-3">
              <div className="label">本机机器码</div>
              <div className="flex gap-2">
                <input
                  disabled
                  className="input min-w-0 flex-1"
                  value={machine?.display ?? '获取中…'}
                />
                <Button
                  className="shrink-0"
                  onClick={copyMachineCode}
                  disabled={!machine}
                >
                  <Copy size={14} /> 复制
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={checkUpdate} disabled={checking || updating}>
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> 检查更新
              </Button>
              {updateResult?.hasUpdate &&
                (updateResult.canUpdate ? (
                  <Button
                    variant="primary"
                    onClick={startUpdate}
                    disabled={updating}
                  >
                    {updating ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <Download size={14} />
                    )}{' '}
                    立即更新{updateResult.latest ? ` v${updateResult.latest}` : ''}
                  </Button>
                ) : updateResult.url ? (
                  <Button
                    variant="primary"
                    onClick={() => window.jueman?.openExternal(updateResult.url!)}
                  >
                    <Download size={14} /> 前往下载 v{updateResult.latest}
                  </Button>
                ) : null)}
              {updateResult?.ok && !updateResult.hasUpdate && (
                <span className="flex items-center gap-1.5 text-xs text-ok">
                  <CheckCircle2 size={14} /> {updateResult.note ?? '已是最新版本'}
                </span>
              )}
              {updateResult && !updateResult.ok && (
                <span className="flex items-center gap-1.5 text-xs text-err">
                  <XCircle size={14} /> {updateResult.error}
                </span>
              )}
              {updateStatus && (
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    updateStatus.phase === 'error' ? 'text-err' : 'text-dim',
                  )}
                >
                  {updateStatus.phase === 'checking' && '正在准备更新…'}
                  {updateStatus.phase === 'available' && '发现新版本，开始下载…'}
                  {updateStatus.phase === 'downloading' &&
                    `正在下载 ${updateStatus.percent ?? 0}%`}
                  {updateStatus.phase === 'downloaded' &&
                    '下载完成，正在重启安装…'}
                  {updateStatus.phase === 'error' &&
                    `更新失败：${updateStatus.message ?? ''}`}
                </span>
              )}
            </div>
            {!isDesktop && (
              <p className="mt-2 text-xs text-dim/70">
                自动更新仅在桌面安装版可用；开发模式或无桌面环境时请手动下载。
              </p>
            )}

            <p className="mt-2 text-xs text-dim/70">
              授权为「一码一机」，更换硬件需重新激活。重新激活会退出当前界面并回到激活页。
            </p>
            <div className="mt-3">
              <Button onClick={reactivate}>
                <RefreshCw size={14} /> 重新激活
              </Button>
            </div>
          </>
        ) : (
          <div className="text-xs text-dim/80">
            浏览器预览模式（未打包），激活仅在桌面端生效。
          </div>
        )}
      </Card>
    </div>
  )
}
