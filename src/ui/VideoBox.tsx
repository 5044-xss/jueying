import { useRef, useState } from 'react'
import { Film } from 'lucide-react'
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
    <video
      ref={ref}
      src={src}
      className={className}
      controls={controls}
      muted={!controls}
      loop={!controls}
      playsInline
      autoPlay={!controls && !hoverPlay}
      preload="metadata"
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
  )
}
