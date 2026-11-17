import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileX } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from '@/pages/PageTitle'
import { performanceApi, type Checkin } from './api'
import { CheckinForm } from './CheckinForm'
import { useLoad, usePerfConfig } from './hooks'
import { BackLink, CheckinStatusPill, Counter, ErrorBlock, FieldError, LoadingCard } from './parts'
import { canAcknowledgeCheckin, canSubmitCheckin, checkinStatusHint, formatDateTime, moodLabel, parseServerError, personName, reviewerLabel, validateFeedback } from './logic'
import './performance.css'

export function CheckinDetail() {
  const { id = '' } = useParams()
  const cfg = usePerfConfig()
  const load = useLoad(() => performanceApi.checkin(id).then((r) => r.data), [id], 'The check-in could not be loaded.')
  const c = load.data
  const [banner, setBanner] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  if (load.error && !c) {
    return (
      <div className="page pf-page" data-testid="checkin-detail-error">
        <BackLink to="/performance?tab=checkins">Back to check-ins</BackLink>
        {load.error.status === 404 ? (
          <EmptyState icon={<FileX size={28} />} title="Check-in not found" body="This check-in does not exist, or you do not have access to it." />
        ) : (
          <ErrorBlock message={load.error.detail} onRetry={load.reload} />
        )}
      </div>
    )
  }
  if (!c) {
    return (
      <div className="page pf-page" data-testid="checkin-detail-loading">
        <BackLink to="/performance?tab=checkins">Back to check-ins</BackLink>
        <LoadingCard rows={4} />
      </div>
    )
  }

  const mayFill = canSubmitCheckin(c)
  const mayAck = canAcknowledgeCheckin(c)
  const back = mayFill ? '/performance?tab=checkins' : mayAck ? '/performance?tab=team' : '/performance?tab=checkins'

  return (
    <div className="page pf-page" data-testid="checkin-detail" data-id={c.checkin_id} data-status={c.status}>
      <BackLink to={back}>Back</BackLink>
      <PageTitle title={`Check-in: ${c.period_label}`} subtitle={`${personName(c.employee)}${c.employee.department ? ` - ${c.employee.department}` : ''}`} />
      {banner ? (
        <div className="pf-flash-block" data-testid="checkin-banner">
          <Alert tone={banner.tone}>{banner.text}</Alert>
        </div>
      ) : null}

      <div className="pf-detail-grid">
        <div className="pf-col">
          <section className="card card-pad" aria-labelledby="checkin-summary-title">
            <div className="pf-card-head">
              <h2 id="checkin-summary-title">Status</h2>
              <CheckinStatusPill status={c.status} reviewer={c.reviewer} />
            </div>
            <p className="pf-help" data-testid="checkin-hint">
              {checkinStatusHint(c)}
            </p>
            <dl className="pf-facts">
              <div>
                <dt>Origin</dt>
                <dd>{c.origin === 'manager' ? `Requested by ${c.requested_by?.name ?? 'a manager'}${c.requested_at ? ` on ${formatDateTime(c.requested_at)}` : ''}` : 'Submitted by the employee'}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd data-testid="checkin-submitted-at">{c.submitted_at ? formatDateTime(c.submitted_at) : 'Not submitted yet'}</dd>
              </div>
              <div>
                <dt>Reviewer</dt>
                <dd data-testid="checkin-reviewer">{reviewerLabel(c.reviewer)}</dd>
              </div>
              <div>
                <dt>Mood</dt>
                <dd data-testid="checkin-mood">{c.mood_visible ? moodLabel(c.mood) : 'Not shared with you'}</dd>
              </div>
            </dl>
          </section>

          {c.status !== 'requested' ? (
            <section className="card card-pad" aria-labelledby="checkin-content-title" data-testid="checkin-content">
              <h2 id="checkin-content-title">Check-in</h2>
              <Block title="Accomplishments" text={c.accomplishments} testId="checkin-text-accomplishments" />
              <Block title="Blockers" text={c.blockers} testId="checkin-text-blockers" />
              <Block title="Next steps" text={c.next_steps} testId="checkin-text-next_steps" />
            </section>
          ) : null}

          {c.status === 'acknowledged' ? (
            <section className="card card-pad" aria-labelledby="checkin-ack-title" data-testid="checkin-ack">
              <h2 id="checkin-ack-title">Acknowledgement</h2>
              <p className="pf-help" data-testid="checkin-ack-by">
                Acknowledged by {c.acknowledged_by?.kind === 'hr' ? 'HR' : c.acknowledged_by?.name ?? 'the reviewer'} on {formatDateTime(c.acknowledged_at)}
              </p>
              <h3 className="pf-subhead">Feedback</h3>
              {c.feedback ? (
                <p className="pf-text" data-testid="checkin-feedback">
                  {c.feedback}
                </p>
              ) : (
                <p className="pf-muted" data-testid="checkin-no-feedback">
                  No written feedback was given.
                </p>
              )}
            </section>
          ) : null}
        </div>

        <div className="pf-col">
          {mayFill ? (
            <section className="card card-pad" aria-labelledby="checkin-fill-title" data-testid="checkin-fill-card">
              <h2 id="checkin-fill-title">Fill in this check-in</h2>
              <CheckinForm
                fill={c}
                limits={cfg.limits}
                onStale={() => {
                  setBanner({ tone: 'danger', text: 'This check-in changed in the meantime; the latest version has been loaded.' })
                  load.reload()
                }}
                onSaved={(saved) => {
                  load.setData(saved)
                  setBanner({ tone: 'info', text: 'Check-in submitted. It is now waiting to be acknowledged.' })
                }}
              />
            </section>
          ) : null}
          {mayAck ? (
            <AcknowledgePanel
              c={c}
              max={cfg.limits.feedback_max}
              onDone={(saved) => {
                load.setData(saved)
                setBanner({ tone: 'info', text: 'Check-in acknowledged. The employee has been notified.' })
              }}
              onStale={() => {
                setBanner({ tone: 'danger', text: 'This check-in changed in the meantime; the latest version has been loaded.' })
                load.reload()
              }}
            />
          ) : null}
          {!mayFill && !mayAck ? (
            <section className="card card-pad" data-testid="checkin-readonly">
              <h2>Read-only</h2>
              <p className="pf-help">There is nothing for you to do on this check-in.</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Block({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <div className="pf-block">
      <h3 className="pf-subhead">{title}</h3>
      {text ? (
        <p className="pf-text" data-testid={testId}>
          {text}
        </p>
      ) : (
        <p className="pf-muted">Nothing written.</p>
      )}
    </div>
  )
}

function AcknowledgePanel({ c, max, onDone, onStale }: { c: Checkin; max: number; onDone: (c: Checkin) => void; onStale: () => void }) {
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function ack() {
    if (busy) return
    const problem = validateFeedback(feedback, max)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const res = await performanceApi.acknowledge(c.checkin_id, feedback)
      onDone(res.data)
    } catch (e) {
      const info = parseServerError(e, 'The check-in could not be acknowledged.')
      if (info.status === 409) onStale()
      else setError(info.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="ack-title" data-testid="ack-panel">
      <h2 id="ack-title">Acknowledge</h2>
      <p className="pf-help">Acknowledging confirms you read it. Feedback is optional, and there is no rating.</p>
      <div className="pf-field">
        <label htmlFor="ack-feedback" className="pf-label">
          Feedback <span className="pf-opt">(optional)</span>
        </label>
        <textarea
          id="ack-feedback"
          className="pf-input pf-textarea"
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'ack-error' : undefined}
          data-testid="ack-feedback"
        />
        <div className="pf-help-row">
          <FieldError id="ack-error" message={error} />
          <Counter value={feedback} max={max} />
        </div>
      </div>
      <div className="pf-actions">
        <button type="button" className="btn btn-primary" onClick={ack} disabled={busy} data-testid="ack-submit">
          {busy ? 'Acknowledging...' : 'Acknowledge'}
        </button>
      </div>
    </section>
  )
}
