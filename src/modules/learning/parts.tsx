import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, Skeleton } from '@/ui/Feedback'
import { confirmationLabel, confirmationTone, pageCount, statusLabel, statusTone, type Tone } from './logic'
import './learning.css'

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`ln-pill ln-pill-${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  )
}

export function StatusPill({ status }: { status: string }) {
  return (
    <Pill tone={statusTone(status)} testId="enrolment-status" title={statusLabel(status)}>
      {statusLabel(status)}
    </Pill>
  )
}

export function ConfirmationPill({ e }: { e: { status: string; confirmation_status: 'not_required' | 'pending' | 'confirmed' | null } }) {
  const label = confirmationLabel(e)
  return label ? (
    <Pill tone={confirmationTone(e)} testId="confirmation-status">
      {label}
    </Pill>
  ) : null
}

export interface TabDef<T extends string> {
  id: T
  label: string
  badge?: number | null
}

export function Tabs<T extends string>({ tabs, active, onSelect, label, testPrefix = 'tab' }: { tabs: TabDef<T>[]; active: T; onSelect: (id: T) => void; label: string; testPrefix?: string }) {
  return (
    <div className="ln-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${testPrefix}-${t.id}`}
          aria-selected={active === t.id}
          className={`ln-tab${active === t.id ? ' active' : ''}`}
          data-testid={`${testPrefix}-${t.id}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
          {t.badge ? <span className="ln-tab-badge" aria-label={`${t.badge} waiting`}>{t.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card card-pad" aria-busy="true" data-testid="loading">
      <Skeleton style={{ height: 18, width: '40%', marginBottom: 14 }} />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} style={{ height: 14, width: `${92 - i * 8}%`, marginBottom: 10 }} />
      ))}
    </div>
  )
}

export function ErrorBlock({ message, onRetry, testId = 'load-error' }: { message: string; onRetry?: () => void; testId?: string }) {
  return (
    <div data-testid={testId}>
      <Alert tone="danger">{message}</Alert>
      {onRetry ? (
        <button type="button" className="btn btn-secondary ln-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  return message ? (
    <p className="ln-field-error" id={id} role="alert">
      {message}
    </p>
  ) : null
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = pageCount(total, pageSize)
  if (pages <= 1) return null
  return (
    <nav className="ln-pager" aria-label="Pagination" data-testid="pager">
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pager-prev">
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </button>
      <span className="ln-pager-label" data-testid="pager-label">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pager-next">
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div className="ln-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label ?? 'Progress'}>
      <span className="ln-progress-bar" style={{ width: `${v}%` }} />
    </div>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <p className="ln-back">
      <Link to={to} className="ln-back-link" data-testid="back-link">
        <ChevronLeft size={16} aria-hidden="true" /> {children}
      </Link>
    </p>
  )
}

export function Counter({ value, max }: { value: string; max: number }) {
  const n = value.trim().length
  return (
    <span className={`ln-counter${n > max ? ' over' : ''}`} aria-hidden="true">
      {n}/{max}
    </span>
  )
}
