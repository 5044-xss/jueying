import { useEffect, useRef, useState } from 'react'
import { Film, Loader2 } from 'lucide-react'
import { needsPlayableConversion, toPlayableUrl } from '@/platform/localMedia'
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
  const [playSrc, setPlaySrc] = useState(src)
  const [wantsPlay, setWantsPlay] = useState(!controls && !hoverPlay)
  const [converting, setConverting] = useState(false)
  const retried = useRef(false)
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setPlaySrc(src)
    setFailed(false)
    setReady(false)
    setWantsPlay(!controls && !hoverPlay)
    retried.current = false
  }, [src, controls, hoverPlay])

  useEffect(() => {
    if (!wantsPlay || converting) return
    void ref.current?.play().catch(() => {})
  }, [wantsPlay, playSrc, converting])

  const convert = async (): Promise<boolean> => {
    if (!needsPlayableConversion(playSrc) || retried.current) return false
    retried.current = true
    setConverting(true)
    try {
      const url = await toPlayableUrl(playSrc)
      if (url !== playSrc) setPlaySrc(url)
      return true
    } catch {
      return false
    } finally {
      setConverting(false)
    }
  }

  const startPlay = () => {
    setWantsPlay(true)
    if (!needsPlayableConversion(playSrc)) return
    void convert().then((ok) => {
      if (!ok) setFailed(true)
    })
  }

  const stopPlay = () => {
    setWantsPlay(false)
    const video = ref.current
    if (!video) return
    video.pause()
    video.currentTime = 0
  }

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
      {(!ready || converting) && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-dim/40">
          <Loader2 size={16} className="animate-spin" />
        </span>
      )}
      <video
        ref={ref}
        src={playSrc}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
          ready ? 'opacity-100' : 'opacity-0',
        )}
        controls={controls}
        muted={!controls}
        loop={!controls}
        playsInline
        autoPlay={!controls && !hoverPlay}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          setReady(true)
          // 安卓本地文件服务器的 Range 请求不可靠，跳转容易直接播放失败。
          if (needsPlayableConversion(playSrc)) return
          if (video.currentTime !== 0 || video.duration <= 0) return
          try {
            video.currentTime = Math.min(0.08, video.duration / 2)
          } catch {
            // 部分格式不支持精确 seek，保持原生首帧
          }
        }}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onError={() => {
          if (converting) return
          if (!retried.current && needsPlayableConversion(playSrc)) {
            void convert().then((ok) => {
              if (!ok) setFailed(true)
            })
            return
          }
          setFailed(true)
        }}
        onMouseEnter={hoverPlay ? startPlay : undefined}
        onMouseLeave={hoverPlay ? stopPlay : undefined}
      />
    </div>
  )
}
