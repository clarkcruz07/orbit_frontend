import { useCallback, useEffect, useRef, useState } from 'react'
import { performanceApi, type PerformanceConfig } from './api'
import { DEFAULT_LIMITS, parseServerError, type ServerErrorInfo } from './logic'

export interface LoadState<T> {
  data: T | null
  error: ServerErrorInfo | null
  loading: boolean
  reload: () => void
  setData: (v: T) => void
}

/**
 * Runs `fn` whenever `deps` change (and on `reload`). A late answer from a stale request is dropped.
 * `fn` returns the already-unwrapped value.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[], fallbackError = 'This could not be loaded.'): LoadState<T> {
  const [data, setDataState] = useState<T | null>(null)
  const [error, setError] = useState<ServerErrorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    fn()
      .then((v) => {
        if (seq.current !== mine) return
        setDataState(v)
        setLoading(false)
      })
      .catch((e) => {
        if (seq.current !== mine) return
        setError(parseServerError(e, fallbackError))
        setLoading(false)
      })
    return () => {
      seq.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback((v: T) => setDataState(v), [])
  return { data, error, loading, reload, setData }
}

export interface PerfConfigState {
  limits: PerformanceConfig['limits']
  hrCanSeeMood: boolean
  loaded: boolean
}

/** Limits come from the server; the fixed values are the fallback. */
export function usePerfConfig(): PerfConfigState {
  const [cfg, setCfg] = useState<PerformanceConfig | null>(null)
  useEffect(() => {
    let live = true
    performanceApi
      .config()
      .then((r) => live && setCfg(r.data))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return {
    limits: cfg?.limits ?? DEFAULT_LIMITS,
    hrCanSeeMood: cfg?.hr_can_see_mood === true,
    loaded: cfg !== null,
  }
}

/** Debounced copy of a value (for filter text boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
