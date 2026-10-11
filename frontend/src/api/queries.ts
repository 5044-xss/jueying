import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { CloudConfig, CreateJobBody, Job, Settings, UpdateJobBody } from './types'

export const qk = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  catalog: ['catalog'] as const,
  assets: ['assets'] as const,
  jobs: ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
}

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => api.health(),
    refetchInterval: 30000,
    retry: false,
  })
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.settings() })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.saveSettings(patch),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  })
}

export function useTestCloud() {
  return useMutation({
    mutationFn: (cloud: Partial<CloudConfig>) => api.testCloud(cloud),
  })
}

export function useCatalog() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: () => api.catalog(),
    enabled: false,
    retry: false,
    staleTime: 60_000,
  })
}

export function useAssets() {
  return useQuery({ queryKey: qk.assets, queryFn: () => api.assets() })
}

export function useJobs(activeInterval = 5000) {
  return useQuery({
    queryKey: qk.jobs,
    queryFn: () => api.jobs(),
    // 仅在有任务生成中/排队中时轮询，空闲时不再请求。
    refetchInterval: (query) => {
      const jobs = query.state.data as Job[] | undefined
      const active = (jobs ?? []).some(
        (j) => j.state === 'running' || j.state === 'queued',
      )
      return active ? activeInterval : false
    },
  })
}

export function useJob(id?: string | null) {
  return useQuery({
    queryKey: qk.job(id ?? ''),
    queryFn: () => api.job(id as string),
    enabled: !!id,
  })
}

export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateJobBody) => api.createJob(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useUpdateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateJobBody }) =>
      api.updateJob(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs }),
  })
}

export function useDuplicateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ source, name }: { source: string; name?: string }) =>
      api.duplicateProject(source, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs }),
  })
}
