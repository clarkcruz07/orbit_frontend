import { useState } from 'react'
import { Alert } from '@/ui/Feedback'
import { parseFailure, peopleApi, type Person } from './api'
import { failureMessage, fieldMessage, type ManagerChoice } from './logic'
import { Field, ManagerPicker, Modal } from './parts'

interface DialogProps {
  person: Person
  onClose: () => void
  /** Called with the server's updated person after a successful change. */
  onDone: (person: Person, message: string) => void
}

/** Plain-words consequences, shown before anything happens. */
export const DEACTIVATE_CONSEQUENCES: readonly string[] = [
  'They are signed out immediately. Their next request is refused, and they cannot sign in again until you reactivate them.',
  'Their history stays: requests, leave, timesheets, documents and the audit trail are kept, and they stay in the directory marked as left. Nothing is deleted.',
  'People who report to them need a new manager. If there are any, you will be asked who takes over.',
]

export function DeactivateDialog({ person, onClose, onDone }: DialogProps) {
  const e = person.employee
  const [step, setStep] = useState<'confirm' | 'reassign'>('confirm')
  const [reports, setReports] = useState<number | null>(null)
  const [newManager, setNewManager] = useState<ManagerChoice | null>(null)
  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldError(null)
    try {
      const body: { end_date?: string; reassign_reports_to?: string } = {}
      if (endDate.trim()) body.end_date = endDate.trim()
      if (step === 'reassign' && newManager) body.reassign_reports_to = newManager.employee_id
      const updated = await peopleApi.deactivate(e.employee_id, body)
      const moved = step === 'reassign' && reports ? ` ${reports} ${reports === 1 ? 'person now reports' : 'people now report'} to ${newManager?.name ?? 'the new manager'}.` : ''
      onDone(updated, `${e.name} was deactivated and signed out.${moved}`)
    } catch (err) {
      const f = parseFailure(err)
      if (f.status === 409 && f.code === 'has_direct_reports') {
        setReports(f.activeDirectReports)
        setStep('reassign')
      } else if (f.status === 422 && f.fieldErrors.reassign_reports_to) {
        setFieldError(fieldMessage('reassign_reports_to', f.fieldErrors.reassign_reports_to))
      } else if (f.status === 422 && f.fieldErrors.end_date) {
        setError(fieldMessage('end_date', f.fieldErrors.end_date))
      } else {
        setError(failureMessage(f, 'The person could not be deactivated.'))
      }
      setBusy(false)
    }
  }

  return (
    <Modal title={`Deactivate ${e.name}?`} onClose={onClose} busy={busy} testId="deactivate-dialog">
      {step === 'confirm' ? (
        <>
          <ul className="pm-consequences" data-testid="deactivate-consequences">
            {DEACTIVATE_CONSEQUENCES.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Field id="deact-end" label="Leaving date" optional help="Leave empty to use today. It cannot be before the start date or more than a year ahead." testId="field-end-date">
            {(a) => <input {...a} className="pm-input" type="date" value={endDate} onChange={(ev) => setEndDate(ev.target.value)} disabled={busy} data-testid="input-end-date" />}
          </Field>
        </>
      ) : (
        <div data-testid="reassign-step">
          <Alert tone="warning">
            {reports ?? 'Some'} active {reports === 1 ? 'person reports' : 'people report'} to {e.name}. Choose who they report to from now on, then confirm.
          </Alert>
          <Field id="deact-mgr" label="New manager for their direct reports" required error={fieldError ?? undefined} help="Only active people are offered." testId="field-reassign">
            {(a) => <ManagerPicker id={a.id} value={newManager} onChange={setNewManager} exclude={[e.employee_id]} describedBy={a['aria-describedby']} invalid={Boolean(fieldError)} testId="reassign" />}
          </Field>
        </div>
      )}
      {error ? (
        <div className="pm-dialog-error" data-testid="dialog-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus data-testid="dialog-cancel">
          Cancel
        </button>
        <button type="button" className="btn pm-btn-danger" onClick={run} disabled={busy || (step === 'reassign' && !newManager)} data-testid="deactivate-confirm">
          {busy ? 'Deactivating...' : step === 'reassign' ? 'Move reports and deactivate' : `Deactivate ${e.name}`}
        </button>
      </div>
    </Modal>
  )
}

export function ReactivateDialog({ person, onClose, onDone }: DialogProps) {
  const e = person.employee
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await peopleApi.reactivate(e.employee_id)
      onDone(updated, `${e.name} is active again.`)
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'The person could not be reactivated.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Reactivate ${e.name}?`} onClose={onClose} busy={busy} testId="reactivate-dialog">
      <ul className="pm-consequences">
        <li>They become active again and the leaving date is cleared.</li>
        <li>Their sign-in is turned back on only if it was turned off by the deactivation. A sign-in you switched off separately stays off.</li>
        <li>Manager links are not restored automatically: people who were moved to another manager stay with that manager.</li>
      </ul>
      {error ? (
        <div className="pm-dialog-error" data-testid="dialog-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus data-testid="dialog-cancel">
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy} data-testid="reactivate-confirm">
          {busy ? 'Reactivating...' : `Reactivate ${e.name}`}
        </button>
      </div>
    </Modal>
  )
}

export function SignInOffDialog({ person, onClose, onDone }: DialogProps) {
  const e = person.employee
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await peopleApi.update(e.employee_id, { can_sign_in: false })
      onDone(updated, `Sign-in is switched off for ${e.name}. They are signed out.`)
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'Sign-in could not be switched off.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Turn off sign-in for ${e.name}?`} onClose={onClose} busy={busy} testId="signin-off-dialog">
      <ul className="pm-consequences">
        <li>They are signed out immediately and cannot sign in until you switch it back on.</li>
        <li>They stay on file, active, with all their history and roles.</li>
      </ul>
      {error ? (
        <div className="pm-dialog-error" data-testid="dialog-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus data-testid="dialog-cancel">
          Cancel
        </button>
        <button type="button" className="btn pm-btn-danger" onClick={run} disabled={busy} data-testid="signin-off-confirm">
          {busy ? 'Switching off...' : 'Turn off sign-in'}
        </button>
      </div>
    </Modal>
  )
}
