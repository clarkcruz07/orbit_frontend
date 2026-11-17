import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { COMMENT_MAX, toProblem } from './logic'

export interface DecisionPanelProps {
  subject: 'timesheet' | 'correction'
  /** The server's allowed_actions for this object: each button exists only when its own action is listed. */
  allowed: readonly string[]
  /** Performs the call; resolves when the server accepted it (the parent then shows the new state). */
  onDecide: (action: 'approve' | 'reject', comment: string) => Promise<void>
}

/** Approve / reject with a comment (required for reject, optional for approve). Buttons are driven only by `allowed`. */
export function DecisionPanel({ subject, allowed, onDecide }: DecisionPanelProps) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needComment, setNeedComment] = useState(false)
  const guard = useRef(false)
  const canApprove = allowed.includes('approve')
  const canReject = allowed.includes('reject')
  if (!canApprove && !canReject) return null

  async function go(action: 'approve' | 'reject') {
    if (guard.current) return
    const text = comment.trim()
    if (action === 'reject' && !text) {
      setNeedComment(true)
      setError(null)
      return
    }
    guard.current = true
    setBusy(action)
    setError(null)
    setNeedComment(false)
    try {
      await onDecide(action, text)
    } catch (e) {
      setError(toProblem(e, 'The decision could not be saved.').detail)
    } finally {
      guard.current = false
      setBusy(null)
    }
  }

  return (
    <section className="card card-pad ts-decision" aria-labelledby={`decision-title-${subject}`} data-testid="decision-panel">
      <h2 id={`decision-title-${subject}`}>Your decision</h2>
      <p className="card-sub">
        {subject === 'timesheet'
          ? 'Approving only confirms the hours. It has no effect on pay: this system does no payroll.'
          : 'Approving layers the corrected times over the original punches. The punches themselves are kept.'}
      </p>
      <label className="ts-field">
        <span>Comment {canReject && canApprove ? '(required to reject, optional to approve)' : canReject ? '(required)' : '(optional)'}</span>
        <textarea
          className="ts-input ts-textarea"
          rows={3}
          maxLength={COMMENT_MAX}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value)
            if (e.target.value.trim()) setNeedComment(false)
          }}
          aria-invalid={needComment}
          aria-describedby={needComment ? 'decision-comment-error' : undefined}
          data-testid="decision-comment"
        />
        <span className="ts-counter">
          {comment.length}/{COMMENT_MAX}
        </span>
      </label>
      {needComment ? (
        <p className="ts-field-error" id="decision-comment-error" role="alert" data-testid="decision-comment-required">
          Add a comment before rejecting, so the person knows what to fix.
        </p>
      ) : null}
      {error ? (
        <div className="ts-msg" data-testid="decision-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="ts-button-row">
        {canApprove ? (
          <button type="button" className="btn btn-primary" onClick={() => go('approve')} disabled={busy !== null} data-testid="decision-approve">
            <Check size={16} aria-hidden="true" /> {busy === 'approve' ? 'Approving...' : 'Approve'}
          </button>
        ) : null}
        {canReject ? (
          <button type="button" className="btn ts-btn-danger-outline" onClick={() => go('reject')} disabled={busy !== null} data-testid="decision-reject">
            <X size={16} aria-hidden="true" /> {busy === 'reject' ? 'Rejecting...' : 'Reject'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
