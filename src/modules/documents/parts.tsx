import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { ACCEPT_ATTR, FILE_HINT, expiryBadge, fileHint, formatBytes, pageCount, rangeText, type Tone } from './logic'
import './documents.css'

export function Pill({ tone = 'neutral', children, testId, title, kind }: { tone?: Tone; children: ReactNode; testId?: string; title?: string; kind?: string }) {
  return (
    <span className={`dc-pill dc-pill-${tone}`} data-testid={testId} data-kind={kind} title={title}>
      {children}
    </span>
  )
}

export function ExpiryBadge({ state, daysLeft }: { state: string | null | undefined; daysLeft: number | null | undefined }) {
  const b = expiryBadge(state, daysLeft)
  return (
    <Pill tone={b.tone} testId="expiry-badge" kind={b.kind}>
      {b.label}
    </Pill>
  )
}

export function Notice({ children, testId, tone = 'warning' }: { children: ReactNode; testId?: string; tone?: 'warning' | 'info' }) {
  return (
    <p className={`dc-notice dc-notice-${tone}`} data-testid={testId} role="note">
      {children}
    </p>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="dc-spinner-row" role="status">
      <span className="boot-spinner dc-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export function ErrorBlock({ message, onRetry, testId = 'load-error' }: { message: string; onRetry?: () => void; testId?: string }) {
  return (
    <div data-testid={testId}>
      <Alert tone="danger">{message}</Alert>
      {onRetry ? (
        <button type="button" className="btn btn-secondary dc-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function LoadingCard({ testId = 'loading' }: { testId?: string }) {
  return (
    <div className="card card-pad" aria-busy="true" data-testid={testId}>
      <span className="skeleton" style={{ height: 18, width: '40%', marginBottom: 14 }} aria-hidden="true" />
      <span className="skeleton" style={{ height: 14, width: '90%', marginBottom: 10 }} aria-hidden="true" />
      <span className="skeleton" style={{ height: 14, width: '75%' }} aria-hidden="true" />
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = pageCount(total, pageSize)
  if (total <= pageSize) return null
  return (
    <nav className="dc-pager" aria-label="Pagination" data-testid="pager">
      <span className="dc-pager-range" data-testid="pager-range">
        {rangeText(page, pageSize, total)}
      </span>
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pager-prev">
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </button>
      <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pager-next">
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  )
}

/** File chooser: a real button (44px on phones) over a hidden input. The hint is advisory; the server validates. */
export function FileField({
  id,
  file,
  onFile,
  error,
  disabled,
  label = 'File',
  testId = 'file-input',
}: {
  id: string
  file: File | null
  onFile: (file: File | null) => void
  error?: string
  disabled?: boolean
  label?: string
  testId?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const hint = fileHint(file)
  return (
    <div className="dc-field">
      <label className="dc-label" htmlFor={id}>
        {label}
      </label>
      <div className="dc-file-row">
        <input
          ref={ref}
          id={id}
          type="file"
          className="dc-visually-hidden"
          accept={ACCEPT_ATTR}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => ref.current?.click()} data-testid={`${testId}-choose`}>
          Choose file
        </button>
        <span className="dc-file-name" data-testid={`${testId}-name`}>
          {file ? `${file.name} (${formatBytes(file.size)})` : 'No file chosen'}
        </span>
      </div>
      <p className="dc-fine">{FILE_HINT}. Only a hint: the service checks the real file when you upload, and a file that fails is not stored.</p>
      {hint ? (
        <p className="dc-hint-warn" data-testid={`${testId}-hint`} role="status">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="dc-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function FieldError({ text }: { text?: string }) {
  return text ? (
    <p className="dc-field-error" role="alert">
      {text}
    </p>
  ) : null
}
