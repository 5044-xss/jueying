import { useEffect, useState } from 'react'
import { needsPlayableConversion, toPlayableUrl } from '@/platform/localMedia'

export function usePlaybackSrc(src?: string | null): { src?: string; loading: boolean } {
  const [resolved, setResolved] = useState<string | undefined>(src ?? undefined)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setResolved(src ?? undefined)
    if (!src || !needsPlayableConversion(src)) {
      setLoading(false)
      return
    }
    setLoading(true)
    void toPlayableUrl(src)
      .then((url) => {
        if (alive) setResolved(url)
      })
      .catch(() => {
        if (alive) setResolved(src)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [src])

  return { src: resolved, loading }
}
