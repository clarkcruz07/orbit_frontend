import { useEffect, useState } from 'react'
import { CheckCircle2, UserMinus, UserPlus } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { useAuthStore } from '@/stores/authStore'
import { casesApi, type CaseDetail, type CasePriority, type CaseStatus, type CaseSummary } from './api'
import { PRIORITIES, assigneeText, hasAction, isPriority, parseServerError, priorityLabel, statusLabel } from './logic'

interface Props {
  c: CaseSummary
  onChanged: (next: CaseDetail) => void
  /** The server said the case changed under us (409): reload it. */
  onStale: () => void
  compact?: boolean
}

/**
 * Status, priority, assignment and the owner's "close" - every control exists only when the server's
 * `allowed_actions` / `allowed_statuses` say so, and each sends the case `version` so a stale edit is refused (409).
 */
export function CaseControls({ c, onChanged, onStale, compact }: Props) {
  const me = useAuthStore((s) => s.user?.user_id ?? null)
  const [statusPick, setStatusPick] = useState('')
  const [priorityPick, setPriorityPick] = useState<CasePriority>(c.priority)
  const [confirmClose, setConfirmClose] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPriorityPick(c.priority)
    setStatusPick('')
    setConfirmClose(false)
  }, [c.priority, c.status, c.version])

  const canStatus = hasAction(c.allowed_actions, 'set_status') && c.allowed_statuses.length > 0
  const canPriority = hasAction(c.allowed_actions, 'set_priority')
  const canAssign = hasAction(c.allowed_actions, 'assign')
  const canClose = hasAction(c.allowed_actions, 'close')
  if (!canStatus && !canPriority && !canAssign && !canClose) return null

  async function run(key: string, call: () => Promise<{ data: CaseDetail }>) {
    setBusy(key)
    setError(null)
    try {
      const res = await call()
      onChanged(res.data)
    } catch (err) {
      const info = parseServerError(err, 'That change could not be saved.')
      if (info.status === 409) {
        setError('This request was changed by someone else, or that move is no longer allowed. The latest state has been loaded.')
        onStale()
      } else setError(info.detail)
    } finally {
      setBusy(null)
    }
  }

  const assignedToMe = Boolean(c.assignee && me && c.assignee.user_id === me)

  return (
    <div className={`hc-controls${compact ? ' hc-controls-compact' : ''}`} data-testid="case-controls">
      {canStatus ? (
        <div className="hc-control" data-testid="control-status">
          <label className="dc-label" htmlFor={`hc-status-${c.case_id}`}>
            Change status
          </label>
          <div className="hc-control-row">
            <select id={`hc-status-${c.case_id}`} className="dc-input" value={statusPick} onChange={(e) => setStatusPick(e.target.value)} disabled={busy !== null} data-testid="status-select">
              <option value="">Choose a status...</option>
              {c.allowed_statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null || !statusPick}
              onClick={() => void run('status', () => casesApi.setStatus(c.case_id, statusPick as CaseStatus, c.version))}
              data-testid="status-apply"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}

      {canPriority ? (
        <div className="hc-control" data-testid="control-priority">
          <label className="dc-label" htmlFor={`hc-priority-${c.case_id}`}>
            Priority
          </label>
          <div className="hc-control-row">
            <select
              id={`hc-priority-${c.case_id}`}
              className="dc-input"
              value={priorityPick}
              onChange={(e) => isPriority(e.target.value) && setPriorityPick(e.target.value)}
              disabled={busy !== null}
              data-testid="priority-select"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null || priorityPick === c.priority}
              onClick={() => void run('priority', () => casesApi.setPriority(c.case_id, priorityPick, c.version))}
              data-testid="priority-apply"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}

      {canAssign ? (
        <div className="hc-control" data-testid="control-assign">
          <div className="dc-label">Assignment</div>
          <div className="dc-sub hc-assignee" data-testid="assignee-text">
            {assigneeText(c.assignee, me)}
          </div>
          <div className="hc-control-row">
            {!assignedToMe && me ? (
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void run('assign', () => casesApi.assign(c.case_id, me, c.version))} data-testid="assign-me">
                <UserPlus size={16} aria-hidden="true" /> Assign to me
              </button>
            ) : null}
            {c.assignee ? (
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void run('unassign', () => casesApi.assign(c.case_id, null, c.version))} data-testid="unassign">
                <UserMinus size={16} aria-hidden="true" /> Unassign
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {canClose ? (
        <div className="hc-control" data-testid="control-close">
          {confirmClose ? (
            <div className="dc-confirm" role="group" aria-label="Confirm closing" data-testid="close-confirm-box">
              <p>Close this request? A closed request is final: nobody can reply to it or change it afterwards.</p>
              <div className="dc-actions">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run('close', () => casesApi.setStatus(c.case_id, 'closed', c.version))} data-testid="close-confirm">
                  Yes, close it
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setConfirmClose(false)}>
                  Keep it open
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setConfirmClose(true)} data-testid="close-case">
              <CheckCircle2 size={16} aria-hidden="true" /> Close this request
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <div data-testid="controls-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </div>
  )
}
