import { useMemo, useState } from 'react'
import { Check, MessageCircleQuestion, Pencil, Send, X } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { leaveApi, type DecisionAction, type LeaveRequest, type LeaveType } from './api'
import { ConflictLink, LeaveForm } from './LeaveForm'
import {
  COMMENT_MAX,
  CONFIRM_TEXT,
  buildPatch,
  buildTimeline,
  decisionTone,
  fieldForCode,
  formFromRequest,
  formatDateTime,
  friendlyError,
  hasAction,
  lastClarification,
  parseLeaveError,
  patchHasChanges,
  validateForm,
  type FormContext,
  type FormErrors,
  type FormValues,
} from './logic'

interface PanelBase {
  req: LeaveRequest
  /** The server's answer after an action: the page replaces its copy and shows the message. */
  onUpdated: (updated: LeaveRequest, message: string) => void
  /** The request moved on (409): the page reloads and says so. */
  onStale: (message: string) => void
}

// ------------------------------------------------------------------------------------------------ approver decision
/** Shown only when the server lists approve / reject / clarify in `allowed_actions`; each button follows its own action. */
export function DecisionPanel({ req, onUpdated, onStale }: PanelBase) {
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState<DecisionAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = comment.trim()
  const can = (a: DecisionAction) => hasAction(req.allowed_actions, a)
  const blocked = (a: DecisionAction) => a !== 'approve' && !trimmed

  async function confirm() {
    if (!pending || busy) return
    setBusy(true)
    setError(null)
    const action = pending
    try {
      const updated = await leaveApi.decide(req.request_id, action, trimmed || null, req.version)
      setPending(null)
      setComment('')
      onUpdated(updated, action === 'approve' ? 'Leave approved. The person has been notified.' : action === 'reject' ? 'Leave rejected. The person has been notified.' : 'Clarification requested. The person has been notified.')
    } catch (err) {
      const info = parseLeaveError(err, 'The decision could not be recorded.')
      setPending(null)
      if (info.status === 409) onStale(info.detail)
      else setError(friendlyError(info))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad lv-section-card lv-decider" aria-labelledby="lv-decide-h" data-testid="decision-panel">
      <h2 id="lv-decide-h">Your decision</h2>
      <p className="card-sub">This request is waiting for your decision.</p>
      <label className="lv-label" htmlFor="decision-comment">
        Comment <span className="lv-opt">(required to reject or ask for clarification)</span>
      </label>
      <textarea
        id="decision-comment"
        className="lv-input lv-textarea"
        rows={4}
        maxLength={COMMENT_MAX}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={busy || pending !== null}
        data-testid="leave-comment"
        aria-describedby="decision-counter"
      />
      <div className="lv-help-row">
        <span>{req.employee?.name ?? 'The person'} can read this comment.</span>
        <span className="lv-counter" id="decision-counter" data-testid="decision-counter">
          {comment.length}/{COMMENT_MAX}
        </span>
      </div>

      {pending ? (
        <div className="lv-confirm" role="alertdialog" aria-label="Confirm your decision" data-testid="decision-confirm-box">
          <p>{CONFIRM_TEXT[pending]}</p>
          <div className="lv-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPending(null)} disabled={busy} data-testid="decision-cancel">
              Go back
            </button>
            <button type="button" className={`btn ${pending === 'reject' ? 'lv-btn-danger' : 'btn-primary'}`} onClick={() => void confirm()} disabled={busy} data-testid="decision-confirm">
              {busy ? 'Saving...' : pending === 'clarify' ? 'Confirm clarification request' : `Confirm ${pending}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="lv-decision-buttons">
          {can('approve') ? (
            <button type="button" className="btn btn-primary" onClick={() => setPending('approve')} data-testid="leave-approve">
              <Check size={16} aria-hidden="true" /> Approve
            </button>
          ) : null}
          {can('clarify') ? (
            <button type="button" className="btn btn-secondary" onClick={() => setPending('clarify')} disabled={blocked('clarify')} title={blocked('clarify') ? 'Write a comment first' : undefined} data-testid="leave-clarify">
              <MessageCircleQuestion size={16} aria-hidden="true" /> Ask for clarification
            </button>
          ) : null}
          {can('reject') ? (
            <button type="button" className="btn lv-btn-danger-outline" onClick={() => setPending('reject')} disabled={blocked('reject')} title={blocked('reject') ? 'Write a comment first' : undefined} data-testid="leave-reject">
              <X size={16} aria-hidden="true" /> Reject
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <div data-testid="decision-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ cancel
/** Shown only when the server lists `cancel`. Cancelling approved leave tells the approver; the wording follows the status. */
export function CancelPanel({ req, onUpdated, onStale }: PanelBase) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approved = req.status === 'approved'

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await leaveApi.cancel(req.request_id, req.version)
      setAsking(false)
      onUpdated(updated, 'Request cancelled. The days are back in your balance.')
    } catch (err) {
      const info = parseLeaveError(err, 'The request could not be cancelled.')
      setAsking(false)
      if (info.status === 409) onStale(info.detail)
      else setError(friendlyError(info))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad lv-section-card" aria-labelledby="lv-cancel-h" data-testid="cancel-panel">
      <h2 id="lv-cancel-h">Cancel this request</h2>
      <p className="card-sub">{approved ? 'You can cancel approved leave until the day it starts. Your approver will be told.' : 'You can cancel this request while it is still open.'}</p>
      {asking ? (
        <div className="lv-confirm" role="alertdialog" aria-label="Confirm cancellation" data-testid="cancel-confirm-box">
          <p>{approved ? 'Cancel this approved leave? Your approver will be notified and the days return to your balance.' : 'Cancel this request? The days will not be used.'}</p>
          <div className="lv-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)} disabled={busy} data-testid="cancel-keep">
              Keep request
            </button>
            <button type="button" className="btn lv-btn-danger" onClick={() => void confirm()} disabled={busy} data-testid="cancel-confirm">
              {busy ? 'Cancelling...' : 'Yes, cancel it'}
            </button>
          </div>
        </div>
      ) : (
        <div className="lv-decision-buttons">
          <button type="button" className="btn lv-btn-danger-outline" onClick={() => setAsking(true)} data-testid="leave-cancel">
            <X size={16} aria-hidden="true" /> Cancel request
          </button>
        </div>
      )}
      {error ? (
        <div data-testid="cancel-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ edit + resubmit
interface EditProps extends PanelBase {
  types: LeaveType[]
  ctx: FormContext
}

/** Owner's edit after a clarification request. "Save" needs `edit`, "Resubmit" needs `resubmit`; both come from the server. */
export function EditPanel({ req, onUpdated, onStale, types, ctx }: EditProps) {
  const [values, setValues] = useState<FormValues>(() => formFromRequest(req))
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'resubmit'>(null)
  const [serverError, setServerError] = useState<{ message: string; conflictingId: string | null } | null>(null)
  const [serverFields, setServerFields] = useState<FormErrors>({})
  const canEdit = hasAction(req.allowed_actions, 'edit')
  const canResubmit = hasAction(req.allowed_actions, 'resubmit')
  const clar = lastClarification(req)

  // The request's own type may have been deactivated since: keep it visible (and flagged) instead of silently swapping it.
  const options = useMemo(
    () => (types.some((t) => t.type_id === req.type_id) ? types : [...types, { type_id: req.type_id, name: req.type_name, paid: req.paid, annual_days: 0, requires_reason: false, active: false, placeholder: false, in_use: null }]),
    [types, req.type_id, req.type_name, req.paid],
  )
  const fullCtx = useMemo(() => ({ ...ctx, types: options }), [ctx, options])
  const errors = useMemo(() => validateForm(values, fullCtx), [values, fullCtx])
  const patch = useMemo(() => buildPatch(values, req), [values, req])
  const dirty = patchHasChanges(patch)
  const shown: FormErrors = attempted ? { ...serverFields, ...errors } : serverFields

  function fail(err: unknown, fallback: string) {
    const info = parseLeaveError(err, fallback)
    if (info.status === 409 && info.code !== 'overlap') {
      onStale(info.detail)
      return
    }
    const field = fieldForCode(info.code)
    const fields: FormErrors = {}
    for (const [k, v] of Object.entries(info.fieldErrors)) if (v) fields[k as keyof FormErrors] = v
    if (field && !fields[field]) fields[field] = friendlyError(info)
    setServerFields(fields)
    setServerError({ message: friendlyError(info), conflictingId: info.conflictingId })
  }

  async function save(): Promise<LeaveRequest | null> {
    if (!dirty) return req
    try {
      return await leaveApi.patch(req.request_id, patch)
    } catch (err) {
      fail(err, 'The changes could not be saved.')
      return null
    }
  }

  async function onSave() {
    setServerError(null)
    setServerFields({})
    if (Object.keys(errors).length > 0) return setAttempted(true)
    setBusy('save')
    const saved = await save()
    setBusy(null)
    if (saved) onUpdated(saved, 'Changes saved. Send the request again when you are ready.')
  }

  async function onResubmit() {
    setServerError(null)
    setServerFields({})
    if (Object.keys(errors).length > 0) return setAttempted(true)
    setBusy('resubmit')
    try {
      const saved = await save()
      if (!saved) return
      const updated = await leaveApi.resubmit(req.request_id, saved.version)
      onUpdated(updated, 'Request sent again for approval.')
    } catch (err) {
      fail(err, 'The request could not be sent again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card card-pad lv-section-card lv-edit" aria-labelledby="lv-edit-h" data-testid="edit-panel">
      <h2 id="lv-edit-h">Update and resubmit</h2>
      {clar ? (
        <div className="lv-clarify" data-testid="clarify-note">
          <strong>{clar.by ?? 'Your approver'} asked:</strong>
          {clar.comment ? <blockquote className="lv-comment">{clar.comment}</blockquote> : <p className="lv-muted">No comment was left.</p>}
        </div>
      ) : null}
      <p className="card-sub">Change what needs changing, then send the request again. Nothing is reserved from your balance until you resubmit.</p>
      <form
        className="lv-edit-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
        }}
        data-testid="leave-edit-form"
      >
        <LeaveForm values={values} onChange={(v) => { setValues(v); setServerError(null); setServerFields({}) }} errors={shown} types={options} ctx={fullCtx} disabled={busy !== null} idPrefix="ed" />
        {serverError ? (
          <div className="lv-form-error" data-testid="edit-error">
            <Alert tone="danger">
              {serverError.message}
              {serverError.conflictingId ? (
                <>
                  {' '}
                  <ConflictLink id={serverError.conflictingId} />
                </>
              ) : null}
            </Alert>
          </div>
        ) : attempted && Object.keys(errors).length > 0 ? (
          <div className="lv-form-error" data-testid="edit-error">
            <Alert tone="danger">Some values need attention first.</Alert>
          </div>
        ) : null}
        <div className="lv-actions">
          {canEdit ? (
            <button type="button" className="btn btn-secondary" onClick={() => void onSave()} disabled={busy !== null || !dirty} title={!dirty ? 'No changes to save' : undefined} data-testid="leave-save">
              <Pencil size={16} aria-hidden="true" /> {busy === 'save' ? 'Saving...' : 'Save changes'}
            </button>
          ) : null}
          {canResubmit ? (
            <button type="button" className="btn btn-primary" onClick={() => void onResubmit()} disabled={busy !== null} data-testid="leave-resubmit">
              <Send size={16} aria-hidden="true" /> {busy === 'resubmit' ? 'Sending...' : dirty ? 'Save and resubmit' : 'Resubmit for approval'}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ timeline
export function Timeline({ req }: { req: LeaveRequest }) {
  const events = buildTimeline(req)
  return (
    <section className="card card-pad lv-section-card" aria-labelledby="lv-timeline-h" data-testid="leave-timeline">
      <h2 id="lv-timeline-h">History</h2>
      <ol className="lv-timeline">
        {events.map((ev) => (
          <li key={ev.key} className="lv-tl-item" data-testid="timeline-item" data-kind={ev.kind}>
            <span className={`lv-tl-dot lv-tl-${ev.kind === 'submitted' || ev.kind === 'resubmitted' ? 'blue' : ev.kind === 'cancelled' ? 'neutral' : decisionTone(ev.kind)}`} aria-hidden="true" />
            <div>
              <div className="lv-tl-title">{ev.title}</div>
              <div className="lv-sub">
                {ev.by ? `${ev.by} - ` : ''}
                {formatDateTime(ev.at)}
              </div>
              {ev.comment ? (
                <blockquote className="lv-comment" data-testid="timeline-comment">
                  {ev.comment}
                </blockquote>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

