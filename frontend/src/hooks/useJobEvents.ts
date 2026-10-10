import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Job } from '../api/types'

// 订阅单个任务：优先 SSE，断线回退轮询 GET /api/jobs/{id}。
export function useJobEvents(jobId: string | null, initialJob?: Job | null) {
  const [job, setJob] = useState<Job | null>(initialJob ?? null)
  const [connected, setConnected] = useState(false)
  const initialRef = useRef(initialJob)

  useEffect(() => {
    initialRef.current = initialJob
  }, [initialJob])

  useEffect(() => {
    if (!jobId) {
      setJob(initialRef.current ?? null)
      setConnected(false)
      return
    }
    setJob(initialRef.current ?? null)

    let es: EventSource | null = null
    let closed = false
    let pollTimer: number | undefined
    let sawDone = false

    const poll = async () => {
      if (closed) return
      try {
        const j = await api.job(jobId)
        setJob(j)
        if (j.state === 'running' || j.state === 'queued') {
          pollTimer = window.setTimeout(poll, 2000)
        } else {
          sawDone = true
        }
      } catch {
        pollTimer = window.setTimeout(poll, 3000)
      }
    }

    const handle = (raw: string) => {
      try {
        setJob(JSON.parse(raw) as Job)
      } catch {
        /* ignore bad frame */
      }
    }

    try {
      es = api.events(jobId)
      es.onopen = () => setConnected(true)
      es.onmessage = (ev) => handle(ev.data)
      es.addEventListener('done', (ev) => {
        const e = ev as MessageEvent
        handle(e.data)
        sawDone = true
        es?.close()
        es = null
        setConnected(false)
      })
      es.onerror = () => {
        es?.close()
        es = null
        setConnected(false)
        if (!closed && !sawDone) poll()
      }
    } catch {
      poll()
    }

    return () => {
      closed = true
      es?.close()
      if (pollTimer) window.clearTimeout(pollTimer)
    }
  }, [jobId])

  return { job, connected }
}
