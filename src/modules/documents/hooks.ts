import { useCallback, useEffect, useRef, useState } from 'react'
import { parseServerError, type ServerErrorInfo } from './logic'

export interface LoadState<T> {
  data: T | null
  error: ServerErrorInfo | null
  loading: boolean
  reload: () => void
  setData: (next: T | null | ((prev: T | null) => T | null)) => void
}

/** Loads on mount and whenever `deps` change; a late answer for an older request is dropped. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], failure = 'This could not be loaded.'): LoadState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ServerErrorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    loadRef
      .current()
      .then((d) => {
        if (!live) return
        setData(d)
        setLoading(false)
      })
      .catch((e) => {
        if (!live) return
        setError(parseServerError(e, failure))
        setData(null)
        setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData }
}

/** Saves a Bearer-fetched blob through a temporary object URL (the token is never in a URL). */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}
