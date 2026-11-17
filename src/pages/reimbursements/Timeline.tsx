import { useCallback, useEffect, useState } from 'react'
import { reimbursementsApi, type AuditEvent, type Reimbursement } from '@/api/reimbursements'
import { useAuthStore } from '@/stores/authStore'
import { Pill, Spinner } from './parts'
import { auditLabel, decisionLabel, decisionTone, formatDateTime, parseServerError, stageLabel } from './logic'

/** Decisions in order, with the reviewer's comment. The employee's submit is shown as the first step. */
export function DecisionTimeline({ req }: { req: Reimbursement }) {
  if (req.decisions.length === 0 && !req.submitted_at) return null
  return (
    <section className="card card-pad r-section" aria-labelledby="r-timeline-h" data-testid="decision-timeline">
      <h2 id="r-timeline-h">Decisions</h2>
      <ol className="r-timeline">
        {req.submitted_at ? (
          <li className="r-tl-item">
            <span className="r-tl-dot r-tl-neutral" aria-hidden="true" />
            <div>
              <div className="r-tl-title">Submitted for review</div>
              <div className="r-sub">
                {req.employee.name ?? 'Unknown employee'} - {formatDateTime(req.submitted_at)}
              </div>
            </div>
          </li>
        ) : null}
        {req.decisions.map((d) => (
          <li key={d.decision_id} className="r-tl-item" data-testid="decision-item" data-action={d.action}>
            <span className={`r-tl-dot r-tl-${decisionTone(d.action)}`} aria-hidden="true" />
            <div>
              <div className="r-tl-title">
                {decisionLabel(d.action)} <Pill tone="neutral">{stageLabel(d.stage) || d.stage}</Pill>
              </div>
              <div className="r-sub">
                {d.by_name ?? d.by_role} ({d.by_role}) - {formatDateTime(d.at)}
              </div>
              {d.comment ? <blockquote className="r-comment">{d.comment}</blockquote> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

const OWNER_ACTIONS = new Set([
  'reimbursement.created',
  'reimbursement.updated',
  'reimbursement.receipt_uploaded',
  'reimbursement.extraction_completed',
  'reimbursement.extraction_failed',
  'reimbursement.submitted',
])

function actorLabel(ev: AuditEvent, req: Reimbursement, myUserId: string | undefined): string {
  if (ev.actor_user_id && ev.actor_user_id === myUserId) return 'You'
  const decider = req.decisions.find((d) => d.by_user_id === ev.actor_user_id)
  if (decider?.by_name) return decider.by_name
  if (OWNER_ACTIONS.has(ev.action)) return req.employee.name ?? 'Unknown employee'
  return ev.actor_roles.length ? ev.actor_roles.join(', ') : 'System'
}

/** `GET /reimbursements/{id}/audit`. Reloads when the request version changes (a new decision, say). */
export function AuditTrail({ req }: { req: Reimbursement }) {
  const myId = useAuthStore((s) => s.user?.user_id)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = req.request_id
  const version = req.version

  const load = useCallback(() => {
    let live = true
    setError(null)
    reimbursementsApi
      .audit(id)
      .then((r) => live && setEvents(r.data))
      .catch((e) => live && setError(parseServerError(e, 'The audit trail could not be loaded.').detail))
    return () => {
      live = false
    }
  }, [id, version])

  useEffect(() => load(), [load])

  return (
    <section className="card card-pad r-section" aria-labelledby="r-audit-h" data-testid="audit-trail">
      <h2 id="r-audit-h">Audit trail</h2>
      <p className="card-sub">Every step on this request, oldest first. Comments, receipt contents and amounts are not stored here.</p>
      {error ? (
        <div className="r-inline-error" data-testid="audit-error">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : events === null ? (
        <Spinner label="Loading the audit trail..." />
      ) : events.length === 0 ? (
        <p className="r-muted">No events recorded.</p>
      ) : (
        <ol className="r-audit-list">
          {events.map((ev) => (
            <li key={ev.event_id} data-testid="audit-item" data-action={ev.action}>
              <span className="r-audit-when">{formatDateTime(ev.at)}</span>
              <span className="r-audit-what">{auditLabel(ev)}</span>
              <span className="r-audit-who">{actorLabel(ev, req, myId)}</span>
              {ev.outcome !== 'success' ? <Pill tone="amber">{ev.outcome}</Pill> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
