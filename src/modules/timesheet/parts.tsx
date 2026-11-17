import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import type { Problem, Tone } from './logic'

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`ts-pill ts-pill-${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  )
}

export function LoadingCard({ lines = 3, testId = 'ts-loading' }: { lines?: number; testId?: string }) {
  return (
    <div className="card card-pad" aria-busy="true" data-testid={testId}>
      <Skeleton style={{ height: 18, width: '40%', marginBottom: 14 }} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} style={{ height: 14, width: `${92 - i * 8}%`, marginBottom: 10 }} />
      ))}
    </div>
  )
}

/** 403/404 mean "not for you" (the server hides what you may not see); anything else is an error with a retry. */
export function ErrorBlock({ problem, onRetry, what = 'This' }: { problem: Problem; onRetry?: () => void; what?: string }) {
  if (problem.status === 403 || problem.status === 404) {
    return (
      <div data-testid="ts-not-available">
        <EmptyState title={`${what} is not available`} body="It is not available for your account, or it does not exist." />
      </div>
    )
  }
  return (
    <div data-testid="ts-error" className="ts-error">
      <Alert tone="danger">{problem.detail}</Alert>
      {onRetry ? (
        <button type="button" className="btn btn-secondary ts-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage, testId = 'ts-pager' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; testId?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav className="ts-pager" aria-label="Pages" data-testid={testId}>
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </button>
      <span className="ts-pager-text">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}

export function Banner({ tone, title, children, testId }: { tone: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`ts-banner ts-banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId}>
      {title ? <strong>{title}</strong> : null}
      {children ? <div>{children}</div> : null}
    </div>
  )
}
