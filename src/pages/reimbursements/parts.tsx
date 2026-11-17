import type { ReactNode } from 'react'
import { statusHint, statusLabel, statusTone, type Tone } from './logic'
import './reimbursements.css'

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`r-pill r-pill-${statusTone(status)}`} title={statusHint(status)} data-testid="status-pill" data-status={status}>
      {statusLabel(status)}
    </span>
  )
}

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`r-pill r-pill-${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="r-spinner-row" role="status">
      <span className="boot-spinner r-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
