import { useEffect, useState, type ReactNode } from 'react'
import type { BadgeTone } from './logic'

/**
 * An on/off switch. A real button with role="switch" so keyboards and screen readers get the right semantics; the whole row
 * label is wired through aria-labelledby/aria-describedby. While a save is in flight the switch is disabled and says so.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  busy,
  labelId,
  describedBy,
  testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  busy?: boolean
  labelId: string
  describedBy?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={`st-switch${checked ? ' on' : ''}${busy ? ' busy' : ''}`}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="st-switch-track" aria-hidden="true">
        <span className="st-switch-thumb" />
      </span>
      <span className="st-switch-state" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  )
}

export function Badge({ tone = 'grey', children, testId }: { tone?: BadgeTone; children: ReactNode; testId?: string }) {
  return (
    <span className={`st-badge st-badge-${tone}`} data-testid={testId}>
      {children}
    </span>
  )
}

/** The page-level card: a title, an optional sub line and the body. */
export function Panel({ title, sub, children, testId, id }: { title: string; sub?: ReactNode; children: ReactNode; testId?: string; id?: string }) {
  return (
    <section className="card st-panel" aria-labelledby={id} data-testid={testId}>
      <header className="st-panel-head">
        <h2 id={id}>{title}</h2>
        {sub ? <p className="card-sub">{sub}</p> : null}
      </header>
      {children}
    </section>
  )
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Fixed-height placeholder rows while a tab loads. */
export function RowsSkeleton({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="st-skeleton" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ height }} aria-hidden="true" />
      ))}
    </div>
  )
}
