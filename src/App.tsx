import { useEffect } from 'react'
import { LicenseBanner } from '@/license/LicenseBanner'
import { LicenseGate } from '@/license/LicenseGate'
import { ComfyClient } from '@/core/comfy'
import { resumeShotJob } from '@/core/generate'
import { activeEndpoint, useApp } from '@/store/app'
import { Shell } from '@/ui/Shell'
import { GeneratePage } from '@/pages/GeneratePage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Toaster } from '@/ui/Toaster'
import {
  downloadLocalMedia,
  extensionOf,
  extensionOfUrl,
  isPlayableLocalUrl,
} from '@/platform/localMedia'

let resumeStarted = false

export function App() {
  const ready = useApp((s) => s.ready)
  const hydrate = useApp((s) => s.hydrate)
  const tab = useApp((s) => s.tab)
  const projectId = useApp((s) => s.projectId)
  const settingsOpen = useApp((s) => s.settingsOpen)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!ready || resumeStarted) return
    resumeStarted = true
    const state = useApp.getState()
    const fallback = activeEndpoint(state)
    let resuming = 0

    for (const project of state.data.projects) {
      for (const shot of project.shots) {
        if (shot.state !== 'queued' && shot.state !== 'running') continue
        if (!shot.promptId) {
          useApp.getState().updateShot(project.id, shot.id, {
            state: 'error',
            error: '应用重启，任务未提交完成',
            finishedAt: Date.now(),
          })
          continue
        }
        const endpoint =
          state.data.endpoints.find((e) => e.id === shot.endpointId) ??
          (shot.endpointId ? undefined : fallback)
        if (!endpoint) {
          useApp.getState().updateShot(project.id, shot.id, {
            state: 'error',
            error: '原生成端已不可用，无法恢复任务',
            finishedAt: Date.now(),
          })
          continue
        }
        resuming += 1
        void resumeShotJob({
          client: new ComfyClient(endpoint.url, endpoint.token),
          shot,
          update: (patch) => useApp.getState().updateShot(project.id, shot.id, patch),
          toast: useApp.getState().toast,
        })
      }
    }

    if (resuming > 0) {
      useApp.getState().toast(`正在恢复 ${resuming} 个未完成任务`)
    }
  }, [ready])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      let failures = 0
      const state = useApp.getState()
      for (const project of state.data.projects) {
        for (const shot of project.shots) {
          if (cancelled) return
          if (shot.state !== 'success' || isPlayableLocalUrl(shot.output)) continue
          const remote = /^https?:/i.test(shot.output ?? '')
            ? shot.output
            : shot.remoteOutput
          if (!remote || !/^https?:/i.test(remote)) continue
          try {
            const ext =
              extensionOfUrl(remote) ?? extensionOf(shot.outputPath) ?? 'mp4'
            const local = await downloadLocalMedia(remote, shot.id, ext)
            if (!cancelled) {
              useApp.getState().updateShot(project.id, shot.id, {
                output: local.url,
                outputPath: local.path,
                remoteOutput: remote,
              })
            }
          } catch {
            failures += 1
            if (failures >= 3) {
              useApp.getState().toast('部分远程视频未能保存到本地', 'err')
              return
            }
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready])

  if (!ready) {
    return <div className="grid h-full place-items-center text-sm text-dim">正在加载…</div>
  }

  return (
    <>
      <LicenseGate>
        <div className="flex h-full min-h-0 flex-col">
          <LicenseBanner />
          <div className="min-h-0 flex-1">
            <Shell>
              {projectId ? (
                <ProjectDetailPage projectId={projectId} />
              ) : tab === 'gen' ? (
                <GeneratePage />
              ) : tab === 'library' ? (
                <LibraryPage />
              ) : (
                <ProjectsPage />
              )}
            </Shell>
          </div>
        </div>
      </LicenseGate>
      {settingsOpen && <SettingsDialog />}
      <Toaster />
    </>
  )
}
