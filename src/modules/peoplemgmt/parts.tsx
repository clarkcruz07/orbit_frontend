import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search, ShieldOff, X } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { managerSearchApi, parseFailure, peopleApi, type DirectoryHit } from './api'
import { MANAGER_QUERY_MAX, pageCount, rangeText, type ManagerChoice, type Tone } from './logic'
import './peoplemgmt.css'

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

export type Access = 'checking' | 'allowed' | 'denied'

/**
 * Pages that start with a form (no read of their own) ask the server once whether this account may use People management:
 * the same HR-only list route answers 403 to everyone else. Only a 403 means "denied"; any other failure lets the page open
 * (the real answer then comes with the first save). No role name is read.
 */
export function useHrAccess(): Access {
  const [access, setAccess] = useState<Access>('checking')
  useEffect(() => {
    let live = true
    peopleApi
      .list({ page_size: 1 })
      .then(() => live && setAccess('allowed'))
      .catch((err) => live && setAccess(parseFailure(err).status === 403 ? 'denied' : 'allowed'))
    return () => {
      live = false
    }
  }, [])
  return access
}

export function NotAvailable({ testId = 'not-available' }: { testId?: string }) {
  return (
    <div data-testid={testId}>
      <EmptyState icon={<ShieldOff size={28} />} title="People management is not available" body="This page is for HR administrators. Your account does not have access to it." />
    </div>
  )
}

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`pm-pill pm-pill-${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  )
}

export function Notice({ children, tone = 'info', testId }: { children: ReactNode; tone?: 'info' | 'warning'; testId?: string }) {
  return (
    <p className={`pm-notice pm-notice-${tone}`} role="note" data-testid={testId}>
      {children}
    </p>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="pm-spinner-row" role="status">
      <span className="boot-spinner pm-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export function ErrorBlock({ message, onRetry, testId = 'load-error' }: { message: string; onRetry?: () => void; testId?: string }) {
  return (
    <div data-testid={testId}>
      <Alert tone="danger">{message}</Alert>
      {onRetry ? (
        <button type="button" className="btn btn-secondary pm-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function LoadingCard({ testId = 'loading', label = 'Loading' }: { testId?: string; label?: string }) {
  return (
    <div className="card card-pad" aria-busy="true" data-testid={testId}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <span className="skeleton" style={{ height: 18, width: '40%', marginBottom: 14 }} aria-hidden="true" />
      <span className="skeleton" style={{ height: 14, width: '90%', marginBottom: 10 }} aria-hidden="true" />
      <span className="skeleton" style={{ height: 14, width: '75%' }} aria-hidden="true" />
    </div>
  )
}

export function Pager({ page, pageSize, total, shown, onPage, testPrefix = 'pm' }: { page: number; pageSize: number; total: number; shown: number; onPage: (p: number) => void; testPrefix?: string }) {
  const pages = pageCount(total, pageSize)
  return (
    <nav className="pm-pager" aria-label="Pages" data-testid={`${testPrefix}-pager`}>
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testPrefix}-prev`}>
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </button>
      <span className="pm-pager-label" data-testid={`${testPrefix}-page-label`}>
        Page {page} of {pages} <span className="pm-muted">({rangeText(page, pageSize, total, shown)})</span>
      </span>
      <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testPrefix}-next`}>
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}

/** A label + control + help + error group. The control is passed the ids it needs. */
export function Field({
  id,
  label,
  required,
  optional,
  help,
  error,
  children,
  testId,
}: {
  id: string
  label: string
  required?: boolean
  optional?: boolean
  help?: ReactNode
  error?: string
  children: (aria: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
  testId?: string
}) {
  const helpId = `${id}-help`
  const errId = `${id}-err`
  const describedBy = [help ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="pm-field" data-testid={testId}>
      <label className="pm-label" htmlFor={id}>
        {label}
        {required ? <span className="pm-req" aria-hidden="true"> *</span> : null}
        {optional ? <span className="pm-opt"> (optional)</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help ? (
        <p className="pm-help" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="pm-field-error" id={errId} role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Accessible modal: focus moves in, Tab stays inside, Escape closes (unless busy), focus returns to the opener, the page behind does not scroll. */
export function Modal({ title, onClose, busy, children, testId }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode; testId?: string }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? ref.current)?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busyRef.current) closeRef.current()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null)
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const a = items[0]
    const z = items[items.length - 1]
    if (e.shiftKey && document.activeElement === a) {
      z.focus()
      e.preventDefault()
    } else if (!e.shiftKey && document.activeElement === z) {
      a.focus()
      e.preventDefault()
    }
  }

  return (
    <div className="pm-modal-scrim" data-testid={testId ? `${testId}-scrim` : undefined} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={ref} className="pm-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} data-testid={testId}>
        <h2 className="pm-modal-title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/**
 * Type-ahead for "who is the manager": the normal directory search. Only ACTIVE people are offered (the directory marks leavers for HR),
 * and `exclude` removes the person being edited and anyone who must not be chosen. The server still checks the rules (cycles, left people).
 */
export function ManagerPicker({
  id,
  value,
  onChange,
  exclude = [],
  disabled,
  describedBy,
  invalid,
  testId = 'manager',
}: {
  id: string
  value: ManagerChoice | null
  onChange: (next: ManagerChoice | null) => void
  exclude?: readonly string[]
  disabled?: boolean
  describedBy?: string
  invalid?: boolean
  testId?: string
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; hits: DirectoryHit[] }>({ kind: 'idle' })
  const debounced = useDebounced(text.trim().slice(0, MANAGER_QUERY_MAX), 250)
  const listId = `${id}-list`
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!debounced) {
      setState({ kind: 'idle' })
      return
    }
    const ctl = new AbortController()
    setState({ kind: 'loading' })
    managerSearchApi
      .search(debounced, ctl.signal)
      .then((hits) => !ctl.signal.aborted && setState({ kind: 'ready', hits: hits.filter((h) => h.status !== 'left' && !exclude.includes(h.employee_id)) }))
      .catch((e: { code?: string }) => !ctl.signal.aborted && e?.code !== 'ERR_CANCELED' && setState({ kind: 'error' }))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  useEffect(() => setActive(0), [state])

  function pick(h: DirectoryHit) {
    onChange({ employee_id: h.employee_id, name: h.name })
    setText('')
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const hits = state.kind === 'ready' ? state.hits : []
    if (e.key === 'ArrowDown' && hits.length) {
      setOpen(true)
      setActive((i) => (i + 1) % hits.length)
      e.preventDefault()
    } else if (e.key === 'ArrowUp' && hits.length) {
      setActive((i) => (i + hits.length - 1) % hits.length)
      e.preventDefault()
    } else if (e.key === 'Enter') {
      if (open && hits[active]) pick(hits[active])
      e.preventDefault()
    } else if (e.key === 'Escape' && open) {
      setOpen(false)
      e.stopPropagation()
    }
  }

  if (value) {
    return (
      <div className="pm-chosen" data-testid={`${testId}-chosen`}>
        <span className="pm-chosen-name" data-testid={`${testId}-chosen-name`}>
          {value.name}
        </span>
        {disabled ? null : (
          <button type="button" className="btn btn-secondary pm-chosen-clear" onClick={() => onChange(null)} data-testid={`${testId}-clear`}>
            <X size={14} aria-hidden="true" /> Clear
          </button>
        )}
      </div>
    )
  }

  const hits = state.kind === 'ready' ? state.hits : []
  const showList = open && debounced.length > 0
  return (
    <div className="pm-picker" ref={wrapRef} onBlur={(e) => !wrapRef.current?.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <div className="pm-picker-box">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          type="text"
          className="pm-picker-input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${id}-opt-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          placeholder="Type a name to search (no manager if left empty)"
          value={text}
          maxLength={MANAGER_QUERY_MAX}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid={`${testId}-input`}
        />
      </div>
      {showList ? (
        <ul className="pm-picker-list" id={listId} role="listbox" aria-label="Matching active people" data-testid={`${testId}-list`}>
          {state.kind === 'loading' ? <li className="pm-picker-note" role="presentation">Searching...</li> : null}
          {state.kind === 'error' ? <li className="pm-picker-note" role="presentation">The search could not be loaded. Try typing again.</li> : null}
          {state.kind === 'ready' && hits.length === 0 ? <li className="pm-picker-note" role="presentation" data-testid={`${testId}-none`}>No active person matches.</li> : null}
          {hits.map((h, i) => (
            <li
              key={h.employee_id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`pm-picker-option${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
              data-testid={`${testId}-option`}
              data-id={h.employee_id}
            >
              <strong>{h.name}</strong>
              <span className="pm-muted">{[h.job_title, h.department].filter(Boolean).join(' - ') || h.employee_id}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
