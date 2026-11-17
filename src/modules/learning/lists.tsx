import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { learningApi, type Enrolment } from './api'
import { ConfirmationPill, Pill, ProgressBar, StatusPill } from './parts'
import { assignedByText, deliveryLabel, dueText, durationLabel, enrolmentCan, parseServerError, personName } from './logic'

/** Confirm / send back, for a completion waiting on the viewer. Each button exists only when the server allows it. */
export function ReviewActions({ e, onChanged }: { e: Enrolment; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | 'confirm' | 'return'>(null)
  const [error, setError] = useState<string | null>(null)
  const may = enrolmentCan(e, 'confirm')
  const mayReturn = enrolmentCan(e, 'return')
  if (!may && !mayReturn) return null

  async function run(kind: 'confirm' | 'return') {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'confirm') await learningApi.confirm(e.enrolment_id)
      else await learningApi.returnCompletion(e.enrolment_id)
      onChanged()
    } catch (err) {
      setError(parseServerError(err, 'That could not be done.').detail)
      // A stale list (someone else decided) is refreshed so the row disappears or changes.
      if (parseServerError(err).status === 409) onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ln-review-actions" data-testid="review-actions">
      {may ? (
        <button type="button" className="btn btn-primary" onClick={() => run('confirm')} disabled={busy !== null} data-testid="confirm-completion">
          {busy === 'confirm' ? 'Confirming...' : 'Confirm completion'}
        </button>
      ) : null}
      {mayReturn ? (
        <button type="button" className="btn btn-secondary" onClick={() => run('return')} disabled={busy !== null} data-testid="return-completion">
          {busy === 'return' ? 'Sending back...' : 'Send back'}
        </button>
      ) : null}
      {error ? (
        <div className="ln-review-error" data-testid="review-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </div>
  )
}

/** One enrolment per card, link to its detail page. `showOwner` adds the person; `review` adds confirm/send-back. */
export function EnrolmentRows({ items, showOwner, review, onChanged }: { items: Enrolment[]; showOwner?: boolean; review?: boolean; onChanged?: () => void }) {
  return (
    <ul className="ln-rows" data-testid="enrolment-list">
      {items.map((e) => {
        const due = dueText(e, (d) => formatDate(d))
        return (
          <li key={e.enrolment_id} className="ln-row-wrap">
            <Link
              to={`/learning/enrolments/${encodeURIComponent(e.enrolment_id)}`}
              className="ln-row card"
              data-testid="enrolment-row"
              data-id={e.enrolment_id}
              data-status={e.status}
              data-overdue={e.overdue ? 'true' : 'false'}
            >
              <div className="ln-row-main">
                <strong className="ln-row-title">{e.course.title}</strong>
                {showOwner ? (
                  <div className="ln-sub" data-testid="enrolment-owner">
                    {personName(e.employee)}
                    {e.employee.department ? ` - ${e.employee.department}` : ''}
                  </div>
                ) : null}
                <div className="ln-sub">
                  {[e.course.category, deliveryLabel(e.course.delivery), durationLabel(e.course.duration_hours)].filter((x) => x && x !== '-').join(' - ')}
                </div>
                <div className="ln-sub">{assignedByText(e)}</div>
              </div>
              <div className="ln-row-side">
                <div className="ln-row-pills">
                  <StatusPill status={e.status} />
                  {e.mandatory ? <Pill tone="violet" testId="mandatory-pill">Mandatory</Pill> : null}
                  {e.overdue ? <Pill tone="red" testId="overdue-pill">Overdue</Pill> : null}
                  {!e.overdue && e.due_soon ? <Pill tone="amber" testId="due-soon-pill">Due soon</Pill> : null}
                  <ConfirmationPill e={e} />
                </div>
                {e.status !== 'cancelled' ? (
                  <div className="ln-row-progress">
                    <ProgressBar value={e.progress} label={`Progress for ${e.course.title}`} />
                    <span className="ln-progress-num" data-testid="enrolment-progress">
                      {e.progress}%
                    </span>
                  </div>
                ) : null}
                {due ? (
                  <div className={`ln-row-meta${e.overdue ? ' ln-overdue' : ''}`} data-testid="due-text">
                    {due}
                  </div>
                ) : null}
              </div>
            </Link>
            {review && onChanged ? <ReviewActions e={e} onChanged={onChanged} /> : null}
          </li>
        )
      })}
    </ul>
  )
}
