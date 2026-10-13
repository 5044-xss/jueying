import type {
  Asset,
  AssetKind,
  CaseImportResult,
  CasesInstallStatus,
  CasesList,
  Catalog,
  CloudConfig,
  CreateJobBody,
  Health,
  Job,
  Settings,
  TestResult,
  UpdateJobBody,
} from './types'

// 生产/Electron 用注入端口（http://127.0.0.1:<port>）；纯浏览器 dev 用空串走 Vite proxy。
const injectedPort = window.jueman?.port
export const apiBase = injectedPort ? `http://127.0.0.1:${injectedPort}` : ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${apiBase}${path}`, init)
  } catch (e) {
    throw new Error(`无法连接后端服务：${(e as Error).message}`)
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const d = data as Record<string, unknown> | string | null
    const detail =
      d && typeof d === 'object' ? (d.detail as string) || (d.message as string) : (d as string)
    throw new Error(detail || res.statusText || `HTTP ${res.status}`)
  }
  return data as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  base: apiBase,

  health: () => request<Health>('/api/health'),

  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', json('PUT', patch)),

  testCloud: (cloud: Partial<CloudConfig>) =>
    request<TestResult>('/api/cloud/test', json('POST', { cloud })),
  catalog: () => request<Catalog>('/api/cloud/catalog'),

  upload: async (file: File, kind: AssetKind) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    return request<Asset>('/api/assets', { method: 'POST', body: fd })
  },
  assets: () => request<Asset[]>('/api/assets'),

  createJob: (body: CreateJobBody) => request<Job>('/api/jobs', json('POST', body)),
  jobs: () => request<Job[]>('/api/jobs'),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  updateJob: (id: string, body: UpdateJobBody) =>
    request<Job>(`/api/jobs/${id}`, json('PATCH', body)),
  deleteJob: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/jobs/${id}`, { method: 'DELETE' }),

  duplicateProject: (source: string, name?: string) =>
    request<{ ok: boolean; project: string; count: number }>(
      '/api/projects/duplicate',
      json('POST', { source, name }),
    ),
  deleteProject: (project: string) =>
    request<{ ok: boolean; project: string; count: number }>(
      '/api/projects/delete',
      json('POST', { project }),
    ),

  cases: () => request<CasesList>('/api/cases'),
  installCases: () =>
    request<CasesInstallStatus>('/api/cases/install', { method: 'POST' }),
  casesInstallStatus: () =>
    request<CasesInstallStatus>('/api/cases/install/status'),
  caseCoverUrl: (name: string) =>
    `${apiBase}/api/cases/${encodeURIComponent(name)}/cover`,
  importCase: (name: string, project?: string) =>
    request<CaseImportResult>(
      `/api/cases/${encodeURIComponent(name)}/import`,
      json('POST', { project }),
    ),
  caseVideo: (name: string) =>
    `${apiBase}/api/cases/${encodeURIComponent(name)}/video`,

  assetUrl: (id: string) => `${apiBase}/api/assets/${id}`,
  videoUrl: (id: string) => `${apiBase}/api/jobs/${id}/video`,
  events: (id: string) =>
    new EventSource(`${apiBase}/api/jobs/${id}/events`),
}
