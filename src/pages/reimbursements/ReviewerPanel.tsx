import { useState } from 'react'
import { Check, MessageCircleQuestion, X } from 'lucide-react'
import { reimbursementsApi, type DecisionAction, type Reimbursement } from '@/api/reimbursements'
import { Alert } from '@/ui/Feedback'
import { MAX_COMMENT, hasAction, parseServerError } from './logic'

const CONFIRM_TEXT: Record<DecisionAction, (stage: string | null) => string> = {
  approve: (stage) =>
    stage === 'manager'
      ? 'Approve this request and send it on to Finance review?'
      : 'Approve this request for reimbursement?',
  reject: () => 'Reject this request? This ends it. The employee will see your comment.',
  clarify: () => 'Ask the employee for clarification? They can edit and resubmit, and it returns to you.',
}

interface Props {
  req: Reimbursement
  /** Called with the updated request after a decision; the page refreshes its timeline and audit trail. */
  onDecided: (updated: Reimbursement) => void
  /** Called when the server says the request moved on (409) so the page can reload. */
  onStale: (message: string) => void
}

/** Shown only when the server lists approve/reject/clarify in `allowed_actions`. */
export function ReviewerPanel({ req, onDecided, onStale }: Props) {
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState<DecisionAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = comment.trim()

  const can = (a: DecisionAction) => hasAction(req.allowed_actions, a)
  const needsComment = (a: DecisionAction) => a !== 'approve'
  const blocked = (a: DecisionAction) => needsComment(a) && !trimmed

  async function confirm() {
    if (!pending || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await reimbursementsApi.decide(req.request_id, pending, trimmed)
      setPending(null)
      setComment('')
      onDecided(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The decision could not be recorded.')
      if (info.status === 409) {
        setPending(null)
        onStale(info.detail)
      } else {
        setError(info.detail)
        setPending(null)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad r-section r-reviewer" aria-labelledby="r-review-h" data-testid="reviewer-panel">
      <h2 id="r-review-h">Your decision</h2>
      <p className="card-sub">
        {req.stage === 'finance' ? 'This request is waiting for Finance review.' : 'This request is waiting for manager review.'}
      </p>

      <label className="r-label" htmlFor="review-comment">
        Comment <span className="r-opt">(required to reject or ask for clarification)</span>
      </label>
      <textarea
        id="review-comment"
        className="r-input r-textarea"
        rows={4}
        maxLength={MAX_COMMENT}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={busy || pending !== null}
        data-testid="review-comment"
        aria-describedby="review-counter"
      />
      <div className="r-help-row">
        <span>The employee can read this comment.</span>
        <span className="r-counter" id="review-counter" data-testid="review-counter">
          {comment.length}/{MAX_COMMENT}
        </span>
      </div>

      {pending ? (
        <div className="r-confirm" role="alertdialog" aria-label="Confirm your decision" data-testid="review-confirm-box">
          <p>{CONFIRM_TEXT[pending](req.stage)}</p>
          <div className="r-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPending(null)} disabled={busy} data-testid="review-cancel">
              Cancel
            </button>
            <button type="button" className={`btn ${pending === 'reject' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void confirm()} disabled={busy} data-testid="review-confirm">
              {busy ? 'Saving...' : `Confirm ${pending === 'clarify' ? 'clarification request' : pending}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="r-decision-buttons">
          {can('approve') ? (
            <button type="button" className="btn btn-primary" onClick={() => setPending('approve')} data-testid="review-approve">
              <Check size={16} aria-hidden="true" /> Approve
            </button>
          ) : null}
          {can('clarify') ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPending('clarify')}
              disabled={blocked('clarify')}
              title={blocked('clarify') ? 'Write a comment first' : undefined}
              data-testid="review-clarify"
            >
              <MessageCircleQuestion size={16} aria-hidden="true" /> Ask for clarification
            </button>
          ) : null}
          {can('reject') ? (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setPending('reject')}
              disabled={blocked('reject')}
              title={blocked('reject') ? 'Write a comment first' : undefined}
              data-testid="review-reject"
            >
              <X size={16} aria-hidden="true" /> Reject
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <div data-testid="review-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <p className="r-no-pay" data-testid="no-payment-note">
        Approving does not trigger any payment, and no payment or accounting entry is made.
      </p>
    </section>
  )
}
