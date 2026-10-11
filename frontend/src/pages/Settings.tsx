import { CheckCircle2, Copy, Download, Eye, EyeOff, RefreshCw, Save, Server, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useCatalog, useSaveSettings, useSettings, useTestCloud } from '../api/queries'
import type { Catalog, Settings, TestResult } from '../api/types'
import type { CheckUpdateResult } from '../global'
import { ModelSelect } from '../components/ModelSelect'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { Spinner } from '../components/ui/Spinner'
import { toast } from '../store/toast'

const cloudSchema = z
  .object({
    type: z.string(),
    base_url: z.string().optional(),
    ssh_host: z.string().optional(),
  })
  .refine((v) => (v.type === 'xgpu' ? !!v.base_url?.trim() : !!v.ssh_host?.trim()), {
    message: '请填写连接地址（仙宫云 base_url 或 AutoDL SSH 主机）',
  })

const MODEL_KEYS: { key: string; label: string; from: keyof Catalog['files'] }[] = [
  { key: 'unet', label: 'UNet 模型', from: 'unet' },
  { key: 'lora', label: 'LoRA', from: 'lora' },
  { key: 'clip', label: 'CLIP / 文本编码器', from: 'clip' },
  { key: 'vvae', label: '视频 VAE', from: 'vae' },
  { key: 'avae', label: '音频 VAE', from: 'vae' },
  { key: 'learned', label: '放大器（learned）', from: 'vae' },
  { key: 'wf', label: '工作流版本', from: 'unet' },
]

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
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [machine, setMachine] = useState<{ code: string; display: string } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null)
  const isDesktop = typeof window !== 'undefined' && !!window.licenseAPI

  useEffect(() => {
    if (!window.licenseAPI) return
    window.licenseAPI
      .getMachineId()
      .then(setMachine)
      .catch(() => undefined)
    window.jueman?.info?.().then((i) => setAppVersion(i.version)).catch(() => undefined)
  }, [])

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

  useEffect(() => {
    if (data && !form) setForm(structuredClone(data))
  }, [data, form])

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

  function onSave() {
    const parsed = cloudSchema.safeParse(cloud)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || '连接参数不完整')
      return
    }
    saveSettings.mutate(
      { cloud: form!.cloud, gen: form!.gen, models: form!.models },
      {
        onSuccess: () => toast.success('配置已保存'),
        onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
      },
    )
  }

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
      <Card>
        <CardTitle
          icon={<Server size={15} />}
          right={
            <Badge tone={cloud.type === 'autodl' ? 'acc' : 'default'}>
              {cloud.type === 'autodl' ? 'AutoDL SSH' : '仙宫云 URL'}
            </Badge>
          }
        >
          云端连接
        </CardTitle>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label">连接类型</div>
            <select
              className="input"
              value={cloud.type}
              onChange={(e) => patchCloud({ type: e.target.value })}
            >
              <option value="xgpu">仙宫云（URL 直连）</option>
              <option value="autodl">AutoDL（SSH 隧道）</option>
            </select>
          </div>
          <div>
            <div className="label">采样链路</div>
            <select
              className="input"
              value={cloud.sampler_mode}
              onChange={(e) => patchCloud({ sampler_mode: e.target.value })}
            >
              <option value="">自动（xgpu→legacy / autodl→new）</option>
              <option value="legacy">legacy</option>
              <option value="new">new</option>
            </select>
          </div>
        </div>

        {cloud.type === 'xgpu' ? (
          <div className="mt-3">
            <div className="label">实例地址 base_url</div>
            <input
              className="input"
              placeholder="https://<实例ID>-8188.container.x-gpu.com"
              value={cloud.base_url}
              onChange={(e) => patchCloud({ base_url: e.target.value })}
            />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="label">SSH 主机</div>
                <input
                  className="input"
                  value={cloud.ssh_host}
                  onChange={(e) => patchCloud({ ssh_host: e.target.value })}
                />
              </div>
              <div>
                <div className="label">SSH 端口</div>
                <input
                  type="number"
                  className="input"
                  value={cloud.ssh_port}
                  onChange={(e) => patchCloud({ ssh_port: Number(e.target.value) || 22 })}
                />
              </div>
              <div>
                <div className="label">SSH 用户</div>
                <input
                  className="input"
                  value={cloud.ssh_user}
                  onChange={(e) => patchCloud({ ssh_user: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label">SSH 密码</div>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="input pr-9"
                    value={cloud.ssh_pass}
                    onChange={(e) => patchCloud({ ssh_pass: e.target.value })}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink"
                    onClick={() => setShowPass((v) => !v)}
                    title={showPass ? '隐藏' : '显示'}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <div className="label">ComfyUI 端口</div>
                <input
                  type="number"
                  className="input"
                  value={cloud.comfy_port}
                  onChange={(e) => patchCloud({ comfy_port: Number(e.target.value) || 8188 })}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="label">模型目录前缀</div>
            <input
              className="input"
              value={cloud.model_prefix}
              onChange={(e) => patchCloud({ model_prefix: e.target.value })}
            />
          </div>
          <div>
            <div className="label">LoRA 前缀（空=同模型前缀）</div>
            <input
              className="input"
              value={cloud.lora_prefix ?? ''}
              placeholder="（可选）"
              onChange={(e) =>
                patchCloud({ lora_prefix: e.target.value === '' ? null : e.target.value })
              }
            />
          </div>
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
          <Button onClick={onSave} disabled={saveSettings.isPending}>
            <Save size={14} /> 保存配置
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
      </Card>

      <Card>
        <CardTitle>生成默认值</CardTitle>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="label">默认时长（秒）</div>
            <input
              type="number"
              min={4}
              max={15}
              className="input"
              value={form.gen.duration_max}
              onChange={(e) =>
                patchGen({ duration_max: Number(e.target.value) || 10 })
              }
            />
          </div>
          <div>
            <div className="label">默认清晰度（MP）</div>
            <input
              type="number"
              step="0.1"
              className="input"
              value={form.gen.megapixels}
              onChange={(e) =>
                patchGen({ megapixels: Number(e.target.value) || 0.5 })
              }
            />
          </div>
          <div>
            <div className="label">默认种子（0=随机）</div>
            <input
              type="number"
              className="input"
              value={form.gen.seed}
              onChange={(e) => patchGen({ seed: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>模型文件名覆盖</CardTitle>
        <p className="mb-3 text-xs text-dim/70">
          留空使用内置明文默认值；可点上方「加载模型列表」从云端读取可用文件名。
        </p>
        <div className="grid grid-cols-2 gap-3">
          {MODEL_KEYS.map((m) => (
            <ModelSelect
              key={m.key}
              label={m.label}
              value={form.models[m.key] ?? ''}
              options={catalog?.files[m.from] ?? []}
              onChange={(v) =>
                setForm((f) => {
                  if (!f) return f
                  const models = { ...f.models }
                  if (v) models[m.key] = v
                  else delete models[m.key]
                  return { ...f, models }
                })
              }
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle
          icon={<ShieldCheck size={15} />}
          right={
            <Badge tone={isDesktop ? 'ok' : 'default'}>
              {isDesktop ? '已激活' : '浏览器预览'}
            </Badge>
          }
        >
          授权与版本
        </CardTitle>
        {isDesktop ? (
          <>
            <div className="text-xs text-dim/80">当前版本 {appVersion || '—'}</div>
            <div className="mt-3">
              <div className="label">本机机器码</div>
              <div className="flex gap-2">
                <input
                  readOnly
                  className="input"
                  value={machine?.display ?? '获取中…'}
                />
                <Button onClick={copyMachineCode} disabled={!machine}>
                  <Copy size={14} /> 复制
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={checkUpdate} disabled={checking}>
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> 检查更新
              </Button>
              {updateResult?.hasUpdate && updateResult.url && (
                <Button
                  variant="primary"
                  onClick={() => window.jueman?.openExternal(updateResult.url!)}
                >
                  <Download size={14} /> 前往下载 v{updateResult.latest}
                </Button>
              )}
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
            </div>

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
