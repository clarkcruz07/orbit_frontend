import type { ComponentType } from 'react'
import { CalendarDays, FileText } from 'lucide-react'
import { coeSummary, leaveSummary, type ChatAction } from '@/api/assistant'
import { formatDate } from '@/lib/dates'
import { actionStatusText, balanceText, dateRangeText, daysText, isActionOpen, type ActionState } from './logic'

/** What every action card receives. Nothing is sent to the server except through these two callbacks, which only run on a button press. */
export interface ActionCardProps {
  action: ChatAction
  state: ActionState
  onConfirm: () => void
  onCancel: () => void
}

function Buttons({ action, state, onConfirm, onCancel, confirmLabel, busyLabel = 'Submitting...' }: ActionCardProps & { confirmLabel: string; busyLabel?: string }) {
  const open = isActionOpen(state)
  const busy = state.phase === 'confirming' || state.phase === 'cancelling'
  const status = actionStatusText(state)
  return (
    <>
      {state.warning ? (
        <p className="or-card-warning" role="alert" data-testid="action-warning">
          {state.warning}
        </p>
      ) : null}
      {status ? (
        <p className={`or-card-status or-card-status-${state.phase}`} role="status" data-testid="action-status" data-phase={state.phase}>
          {status}
        </p>
      ) : null}
      <div className="or-card-actions">
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!open || busy} data-testid="action-confirm" data-action={action.action_id}>
          {state.phase === 'confirming' ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!open || busy} data-testid="action-cancel">
          {state.phase === 'cancelling' ? 'Cancelling...' : 'Cancel'}
        </button>
      </div>
    </>
  )
}

function FileLeaveCard(props: ActionCardProps) {
  const s = leaveSummary(props.action)
  return (
    <section className="or-card" aria-label="Leave request to confirm" data-testid="action-card" data-kind={props.action.kind} data-phase={props.state.phase}>
      <h3 className="or-card-title">
        <CalendarDays size={16} aria-hidden="true" /> Please check this leave request
      </h3>
      <dl className="or-card-facts">
        <div>
          <dt>Leave type</dt>
          <dd data-testid="card-type">{s.leave_type_name}</dd>
        </div>
        <div>
          <dt>Dates</dt>
          <dd data-testid="card-dates">{dateRangeText(s.start_date, s.end_date)}</dd>
        </div>
        <div>
          <dt>Working days</dt>
          <dd data-testid="card-days">{daysText(s.days)}</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd data-testid="card-balance">{balanceText(s.balance_after)}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd data-testid="card-reason">{s.reason || 'No reason given'}</dd>
        </div>
      </dl>
      <p className="or-card-note">Nothing is sent until you press Submit request.</p>
      <Buttons {...props} confirmLabel="Submit request" />
    </section>
  )
}

/** Certificate of Employment: the details come from the person's own record (read-only here); they only choose the reason in chat. */
function GenerateCoeCard(props: ActionCardProps) {
  const s = coeSummary(props.action)
  return (
    <section className="or-card" aria-label="Certificate of Employment to confirm" data-testid="action-card" data-kind={props.action.kind} data-phase={props.state.phase}>
      <h3 className="or-card-title">
        <FileText size={16} aria-hidden="true" /> Certificate of Employment
      </h3>
      <dl className="or-card-facts or-card-form">
        <div>
          <dt>Name</dt>
          <dd data-testid="coe-name">{s.name || '-'}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd data-testid="coe-position">{s.position || '-'}</dd>
        </div>
        <div>
          <dt>Employed since</dt>
          <dd data-testid="coe-since">{formatDate(s.employed_since)}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd data-testid="coe-reason">{s.reason || '-'}</dd>
        </div>
      </dl>
      <p className="or-card-issue" data-testid="coe-issue-date">
        Issue date: {formatDate(s.issue_date)}
      </p>
      <p className="or-card-note">Details come from your employee record. The certificate is a draft until HR / the Managing Director signs it.</p>
      <Buttons {...props} confirmLabel="Generate PDF" busyLabel="Generating..." />
    </section>
  )
}

/** A kind this version does not know how to show: say so and let the person dismiss it. Nothing can be confirmed from here. */
function UnknownActionCard({ action, state, onCancel }: ActionCardProps) {
  const open = isActionOpen(state)
  const status = actionStatusText(state)
  return (
    <section className="or-card" aria-label="Suggested action" data-testid="action-card" data-kind={action.kind} data-phase={state.phase}>
      <p className="or-card-note">Orbit suggested something this version of the app cannot show here, so it was not done.</p>
      {status ? (
        <p className="or-card-status" role="status" data-testid="action-status">
          {status}
        </p>
      ) : null}
      <div className="or-card-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!open} data-testid="action-cancel">
          Dismiss
        </button>
      </div>
    </section>
  )
}

/** One renderer per action kind. Adding a kind (timesheet, reimbursement, ...) is one entry here. */
export const ACTION_RENDERERS: Record<string, ComponentType<ActionCardProps>> = {
  file_leave: FileLeaveCard,
  generate_coe: GenerateCoeCard,
}

export function ActionCard(props: ActionCardProps) {
  const Card = ACTION_RENDERERS[props.action.kind] ?? UnknownActionCard
  return <Card {...props} />
}
