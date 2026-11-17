import { useEffect, useState } from 'react'
import { Alert } from '@/ui/Feedback'
import { parseFailure, peopleApi, type Person } from './api'
import { ROLE_LABEL, accountBadge, disabledText, failureMessage, formFromPerson, rolesChanged, rolesBody, rolesList, signInSourceLabel, type GrantableRole } from './logic'
import { Pill } from './parts'
import { RolesFields } from './RolesFields'
import { SIGN_IN_EXPLAIN } from './PersonNew'

/**
 * The sign-in account of one person. Every guard rail comes from the SERVER: the Save button is never pre-disabled for "yourself" or
 * "the last HR administrator"; the server's own reason is shown when it refuses.
 */
export function AccountCard({
  person,
  onChanged,
  onAskSignInOff,
}: {
  person: Person
  onChanged: (next: Person, message: string) => void
  onAskSignInOff: () => void
}) {
  const a = person.account
  const badge = accountBadge(person)
  const [roles, setRoles] = useState<Record<GrantableRole, boolean>>(() => formFromPerson(person).roles)
  const [busy, setBusy] = useState<'roles' | 'signin' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A fresh person from the server (after any save) resets the checkboxes to what is really stored.
  useEffect(() => {
    setRoles(formFromPerson(person).roles)
  }, [person])

  async function saveRoles() {
    if (busy) return
    setBusy('roles')
    setError(null)
    try {
      const next = await peopleApi.setRoles(person.employee.employee_id, rolesBody(roles))
      onChanged(next, next.account.roles.join() === a.roles.join() ? 'Roles are unchanged.' : 'Roles saved. They apply from the person\'s next request.')
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'The roles could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function allowSignIn() {
    if (busy) return
    setBusy('signin')
    setError(null)
    try {
      const next = await peopleApi.update(person.employee.employee_id, { can_sign_in: true })
      onChanged(next, a.has_account ? 'Sign-in is switched on again.' : 'Sign-in allowed. They sign in with their Microsoft work account once the email matches.')
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'Sign-in could not be switched on.'))
    } finally {
      setBusy(null)
    }
  }

  const deactivated = a.disabled_reason === 'deactivated'

  return (
    <section className="card card-pad pm-card-section" aria-labelledby="pm-account-h" data-testid="account-card" data-account={badge.kind}>
      <div className="pm-section-head">
        <h2 className="pm-h2" id="pm-account-h">
          Account
        </h2>
        <Pill tone={badge.tone} testId="account-state">
          {badge.label}
        </Pill>
      </div>

      <dl className="pm-facts">
        <div>
          <dt>Sign-in source</dt>
          <dd data-testid="account-source">{signInSourceLabel(a.source)}</dd>
        </div>
        <div>
          <dt>Roles</dt>
          <dd data-testid="account-roles">{a.has_account ? rolesList(a.roles).map((r) => ROLE_LABEL[r] ?? r).join(', ') : 'None - no sign-in account'}</dd>
        </div>
      </dl>

      {a.has_account && a.source === 'hr_created' ? <p className="pm-help" data-testid="no-password-note">{SIGN_IN_EXPLAIN}</p> : null}
      {a.disabled ? (
        <div className="pm-account-note" data-testid="disabled-note">
          <Alert tone="warning">{disabledText(a.disabled_reason)}</Alert>
        </div>
      ) : null}

      {error ? (
        <div className="pm-account-note" data-testid="account-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {!a.has_account ? (
        <div className="pm-account-block" data-testid="no-account-block">
          <p>This person is on file only: they cannot sign in and have no roles. {SIGN_IN_EXPLAIN}</p>
          <button type="button" className="btn btn-primary" onClick={allowSignIn} disabled={busy !== null} data-testid="allow-sign-in">
            {busy === 'signin' ? 'Allowing...' : 'Allow sign-in with Microsoft'}
          </button>
        </div>
      ) : (
        <>
          <div className="pm-account-block">
            <RolesFields roles={roles} onChange={setRoles} disabled={busy !== null} idPrefix="acct-role" />
            <p className="pm-help" data-testid="roles-hint">
              The service checks every change. You cannot change your own roles, and the last active HR Administrator cannot lose that role. Roles from the Microsoft role map or the configured sign-in user list can be re-applied at the next sign-in or start-up.
            </p>
            <button type="button" className="btn btn-primary" onClick={saveRoles} disabled={busy !== null || !rolesChanged(a.roles, roles)} data-testid="save-roles">
              {busy === 'roles' ? 'Saving...' : 'Save roles'}
            </button>
          </div>
          <div className="pm-account-block">
            {a.can_sign_in ? (
              <button type="button" className="btn btn-secondary" onClick={onAskSignInOff} disabled={busy !== null} data-testid="turn-off-sign-in">
                Turn off sign-in
              </button>
            ) : deactivated ? (
              <p className="pm-help" data-testid="reactivate-to-sign-in">Reactivate the person (below) to turn sign-in back on.</p>
            ) : (
              <button type="button" className="btn btn-primary" onClick={allowSignIn} disabled={busy !== null} data-testid="allow-sign-in">
                {busy === 'signin' ? 'Switching on...' : 'Switch sign-in back on'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
