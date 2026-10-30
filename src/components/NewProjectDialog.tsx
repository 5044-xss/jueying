import { useState } from 'react'
import type { Aspect, Project } from '@/core/types'
import { DURATIONS } from '@/lib/resolution'
import { useApp } from '@/store/app'
import { Modal } from '@/ui/Modal'

const ASPECTS: Aspect[] = ['16:9', '9:16', '1:1', '4:3', '3:4']

export function NewProjectDialog({
  onClose,
  project,
}: {
  onClose: () => void
  project?: Project
}) {
  const createProject = useApp((s) => s.createProject)
  const updateProject = useApp((s) => s.updateProject)
  const [name, setName] = useState(project?.name ?? '')
  const [aspect, setAspect] = useState<Aspect>(project?.defaultParams.aspect ?? '16:9')
  const [duration, setDuration] = useState(project?.defaultParams.duration ?? 8)

  const submit = () => {
    if (project) {
      updateProject(project.id, { name, defaultParams: { aspect, duration } })
    } else {
      createProject(name, { aspect, duration })
    }
    onClose()
  }

  return (
    <Modal
      title={project ? '编辑项目' : '新建项目'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {project ? '保存' : '创建'}
          </button>
        </>
      }
    >
      <label className="grid gap-1.5">
        <span className="text-[11.5px] text-dim">项目名称</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="例如：城市广场的告白"
          className="input"
        />
      </label>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="grid gap-1.5">
          <span className="text-[11.5px] text-dim">比例</span>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as Aspect)}
            className="input"
          >
            {ASPECTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[11.5px] text-dim">默认时长</span>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="input"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  )
}
