import { useRef, useState } from 'react'
import { Film, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function VideoBox({
  src,
  className,
  controls,
  hoverPlay,
}: {
  src: string
  className?: string
  controls?: boolean
  hoverPlay?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)

  if (failed) {
    return (
      <div
        className={cn(
          'grid place-items-center gap-1 bg-soft text-center text-[10px] text-dim',
          className,
        )}
      >
        <Film size={20} className="text-dim/40" />
        <span>视频未缓存</span>
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden bg-soft', className)}>
      {!ready && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-dim/40">
          <Loader2 size={16} className="animate-spin" />
        </span>
      )}
      <video
        ref={ref}
        src={src}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
          ready ? 'opacity-100' : 'opacity-0',
        )}
        controls={controls}
        muted={!controls}
        loop={!controls}
        playsInline
        autoPlay={!controls && !hoverPlay}
        preload={controls ? 'metadata' : 'auto'}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          if (video.currentTime !== 0 || video.duration <= 0) return
          try {
            video.currentTime = Math.min(0.08, video.duration / 2)
          } catch {
            // 部分格式不支持精确 seek，保持原生首帧
          }
        }}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onError={() => setFailed(true)}
        onMouseEnter={
          hoverPlay
            ? () => {
                void ref.current?.play().catch(() => {})
              }
            : undefined
        }
        onMouseLeave={
          hoverPlay
            ? () => {
                const video = ref.current
                if (!video) return
                video.pause()
                video.currentTime = 0
              }
            : undefined
        }
      />
    </div>
  )
}
