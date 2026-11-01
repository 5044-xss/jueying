export interface SystemStats {
  comfyuiVersion?: string
  devices: { name: string; vramTotal: number; vramFree: number }[]
}

export interface HistoryOutput {
  filename: string
  subfolder: string
  type: string
}

export interface HistoryEntry {
  promptId: string
  completed: boolean
  outputs: HistoryOutput[]
  statusText?: string
}

export interface TestResult {
  ok: boolean
  detail: string
  stats?: SystemStats
}

export class ComfySubmitError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`提交失败：${status} ${shorten(body, 800)}`)
    this.name = 'ComfySubmitError'
    this.status = status
    this.body = body
  }
}

const TIMEOUT_MS = 20_000

function withTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export class ComfyClient {
  readonly baseUrl: string
  private readonly token?: string

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = normalizeBase(baseUrl)
    this.token = token?.trim() || undefined
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    if (this.token) h.Authorization = `Bearer ${this.token}`
    return h
  }

  private async request(path: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<Response> {
    const { signal, done } = withTimeout(timeout, init.signal ?? undefined)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        headers: this.headers(init.headers as Record<string, string> | undefined),
      })
      return res
    } finally {
      done()
    }
  }

  async test(): Promise<TestResult> {
    try {
      const res = await this.request('/system_stats')
      if (!res.ok) {
        return { ok: false, detail: `生成端返回 ${res.status}${res.status === 503 ? '（实例未启动）' : ''}` }
      }
      const raw = await res.json()
      return { ok: true, detail: '连接成功', stats: parseStats(raw) }
    } catch (err) {
      return { ok: false, detail: describeError(err) }
    }
  }

  async queue(): Promise<{ running: string[]; pending: string[] }> {
    const res = await this.request('/queue')
    if (!res.ok) throw new Error(`查询队列失败：${res.status}`)
    const data = await res.json()
    return {
      running: (data.queue_running ?? []).map((row: unknown[]) => String(row[1])),
      pending: (data.queue_pending ?? []).map((row: unknown[]) => String(row[1])),
    }
  }

  async queueDelete(promptIds: string[]): Promise<void> {
    await this.request('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: promptIds }),
    })
  }

  async objectInfo(): Promise<Record<string, unknown>> {
    const res = await this.request('/object_info', {}, 30_000)
    if (!res.ok) throw new Error(`读取节点信息失败：${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }

  async history(promptId: string): Promise<HistoryEntry | null> {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`)
    if (!res.ok) throw new Error(`查询任务失败：${res.status}`)
    const data = await res.json()
    const entry = data?.[promptId]
    if (!entry) return null
    return {
      promptId,
      completed: Boolean(entry.status?.completed),
      statusText: entry.status?.status_str,
      outputs: collectOutputs(entry.outputs ?? {}),
    }
  }

  viewUrl(filename: string, subfolder = '', type = 'output'): string {
    const q = new URLSearchParams({ filename, type })
    if (subfolder) q.set('subfolder', subfolder)
    return `${this.baseUrl}/view?${q.toString()}`
  }

  async upload(file: File, _kind: 'image' | 'audio' = 'image'): Promise<{ name: string; subfolder: string }> {
    const form = new FormData()
    form.append('image', file, file.name)
    form.append('overwrite', 'true')
    const res = await this.request('/upload/image', { method: 'POST', body: form }, 300_000)
    if (!res.ok) throw new Error(`上传素材失败：${res.status}`)
    const data = await res.json()
    return { name: String(data.name ?? ''), subfolder: String(data.subfolder ?? '') }
  }

  async submit(workflow: unknown, clientId: string): Promise<string> {
    const res = await this.request(
      '/prompt',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      },
      60_000,
    )
    const text = await res.text()
    if (!res.ok) throw new ComfySubmitError(res.status, text)
    let data: { prompt_id?: string; error?: unknown }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`提交失败：返回内容无法解析`)
    }
    if (!data.prompt_id) throw new Error(`提交失败：${shorten(JSON.stringify(data.error ?? data))}`)
    return data.prompt_id
  }

  async interrupt(): Promise<void> {
    await this.request('/interrupt', { method: 'POST' })
  }

  /** 任务进度/完成事件。浏览器与 WebView 均可直连。 */
  connectEvents(clientId: string, handlers: {
    onProgress?: (value: number, max: number, promptId?: string) => void
    onExecuting?: (node: string | null, promptId?: string) => void
    onError?: (err: Event) => void
    onClose?: () => void
  }): () => void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(clientId)}`
    const ws = new WebSocket(wsUrl)
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        const msg = JSON.parse(event.data)
        const promptId =
          typeof msg.data?.prompt_id === 'string' ? msg.data.prompt_id : undefined
        if (msg.type === 'progress') {
          handlers.onProgress?.(msg.data?.value ?? 0, msg.data?.max ?? 0, promptId)
        }
        if (msg.type === 'progress_state') {
          const nodes = Object.values(
            (msg.data?.nodes ?? {}) as Record<
              string,
              { value?: number; max?: number; state?: string }
            >,
          )
          // progress_state 会带上所有已完成节点（max 常为 1），把它们当成 100%
          // 会让进度条在第一个节点结束时直接跳到 99%，之后的真实进度全被吞掉。
          const running = nodes.filter(
            (node) => node.state === 'running' && Number(node.max) > 0,
          )
          if (!running.length) return
          const ratio = Math.max(
            ...running.map((node) => Number(node.value ?? 0) / Number(node.max)),
          )
          handlers.onProgress?.(ratio, 1, promptId)
        }
        if (msg.type === 'executing') {
          handlers.onExecuting?.(msg.data?.node ?? null, promptId)
        }
      } catch {
        // 忽略无法解析的帧
      }
    }
    ws.onerror = (err) => handlers.onError?.(err)
    ws.onclose = () => handlers.onClose?.()
    return () => ws.close()
  }
}

function parseStats(raw: unknown): SystemStats {
  const root = raw as { system?: Record<string, unknown>; devices?: Record<string, unknown>[] }
  return {
    comfyuiVersion: root.system?.comfyui_version ? String(root.system.comfyui_version) : undefined,
    devices: (root.devices ?? []).map((d) => ({
      name: String(d.name ?? 'unknown'),
      vramTotal: Number(d.vram_total ?? 0),
      vramFree: Number(d.vram_free ?? 0),
    })),
  }
}

function collectOutputs(outputs: Record<string, Record<string, unknown>>): HistoryOutput[] {
  const result: HistoryOutput[] = []
  for (const node of Object.values(outputs)) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue
      for (const item of value) {
        const file = item as { filename?: string; subfolder?: string; type?: string }
        if (file?.filename) {
          result.push({
            filename: file.filename,
            subfolder: file.subfolder ?? '',
            type: file.type ?? 'output',
          })
        }
      }
    }
  }
  return result
}

function shorten(text: string, max = 240): string {
  let out = text.replace(/\s+/g, ' ').trim()
  if (out.length > max) out = out.slice(0, max) + '…'
  return out
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '连接超时'
  if (err instanceof TypeError) return '无法连接（地址错误、实例未启动或网络不通）'
  return err instanceof Error ? err.message : String(err)
}
