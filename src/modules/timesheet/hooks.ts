import { useCallback, useEffect, useRef, useState } from 'react'
import { toProblem, type Problem } from './logic'

export interface Loaded<T> {
  data: T | null
  error: Problem | null
  loading: boolean
  /** Date.now() when the data last arrived (for server-clock offsets). */
  at: number
  /** Reload; the old data stays on screen while the new one loads. */
  reload: () => void
  setData: (next: T | null) => void
}

/** Loads on mount and whenever `deps` change (the data is cleared then); `reload()` keeps what is shown. Stale answers are dropped. */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[], fallback = 'This could not be loaded.'): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: Problem | null; loading: boolean; at: number }>({ data: null, error: null, loading: true, at: 0 })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const silent = useRef(false)

  useEffect(() => {
    let live = true
    if (silent.current) {
      silent.current = false
      setState((s) => ({ ...s, loading: true, error: null }))
    } else {
      setState({ data: null, error: null, loading: true, at: 0 })
    }
    fnRef.current().then(
      (data) => live && setState({ data, error: null, loading: false, at: Date.now() }),
      (e) => live && setState((s) => ({ data: null, error: toProblem(e, fallback), loading: false, at: s.at })),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => {
    silent.current = true
    setTick((t) => t + 1)
  }, [])
  const setData = useCallback((data: T | null) => setState((s) => ({ ...s, data, error: null, loading: false })), [])
  return { ...state, reload, setData }
}

/** `window.matchMedia` as state (false where it is unavailable). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** A ticking clock (ms) that only runs while `active`. */
export function useTicker(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [active, everyMs])
  return now
}
