import { Download, FolderOpen } from 'lucide-react'
import { api } from '../api/client'
import { isElectron, openOutputDir } from '../lib/desktop'
import { Button } from './ui/Button'

export function VideoPlayer({ jobId }: { jobId: string }) {
  const src = api.videoUrl(jobId)
  return (
    <div className="flex flex-col gap-2">
      {/* key 保证切换任务时重新加载；固定画框，任意比例都居中contain，不变形不撑高 */}
      <div className="flex h-[clamp(240px,46vh,440px)] items-center justify-center overflow-hidden rounded-2xl bg-black shadow-card">
        <video
          key={jobId}
          src={src}
          controls
          className="h-full w-full object-contain"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href={src} download={`${jobId}.mp4`}>
          <Download size={14} /> 下载成片
        </a>
        {isElectron && (
          <Button onClick={() => void openOutputDir()}>
            <FolderOpen size={14} /> 打开成片目录
          </Button>
        )}
      </div>
    </div>
  )
}
