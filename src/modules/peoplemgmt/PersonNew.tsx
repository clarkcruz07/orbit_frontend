import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { PageTitle } from '@/pages/PageTitle'
import { parseFailure, peopleApi } from './api'
import { buildCreateBody, emptyForm, failureMessage, fieldErrorsText, validatePersonForm, type FieldErrors, type PersonForm } from './logic'
import { LoadingCard, Notice, NotAvailable, useHrAccess } from './parts'
import { PersonFields } from './PersonFields'
import { ProfileNewSections } from './ProfileParts'
import { buildProfileCreate, emptyProfileForm, validateProfileForm, type ProfileForm } from './profileLogic'
import { RolesFields } from './RolesFields'
import '@/pages/pages.css'
import './peoplemgmt.css'

export const SIGN_IN_EXPLAIN =
  'No password is created or stored. The person signs in with their Microsoft work account, and only once the email address above matches that account. Until then they cannot sign in.'

/** HR: add one person (and, by default, a sign-in account with no password). */
export function PersonNew() {
  const navigate = useNavigate()
  const now = useMemo(() => new Date(), [])
  const [form, setForm] = useState<PersonForm>(emptyForm)
  const [profile, setProfile] = useState<ProfileForm>(emptyProfileForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const errRef = useRef<HTMLDivElement>(null)
  const access = useHrAccess()
  useEffect(() => () => { alive.current = false }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const local = { ...validatePersonForm(form, now), ...validateProfileForm(profile) }
    if (Object.keys(local).length) {
      setErrors(local)
      setBanner('Please fix the highlighted fields.')
      return
    }
    setBusy(true)
    setErrors({})
    setBanner(null)
    try {
      const body = buildCreateBody(form)
      const profileBody = buildProfileCreate(profile)
      const person = await peopleApi.create(profileBody ? { ...body, profile: profileBody } : body)
      navigate(`/people/${encodeURIComponent(person.employee.employee_id)}`, { state: { created: true } })
    } catch (err) {
      const f = parseFailure(err)
      if (f.status === 409 && f.code === 'email_exists') {
        setErrors({ email: failureMessage(f, '') })
        setBanner(null)
      } else if (f.status === 422 && Object.keys(f.fieldErrors).length) {
        setErrors(fieldErrorsText(f.fieldErrors))
        setBanner('The service did not accept some values. See the highlighted fields.')
      } else {
        setBanner(failureMessage(f, 'The person could not be added.'))
      }
      window.setTimeout(() => errRef.current?.focus(), 0)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="page pm-page" data-testid="person-new">
      <p className="pm-back">
        <Link to="/people" className="pm-back-link" data-testid="back-to-people">
          <ArrowLeft size={16} aria-hidden="true" /> Back to people
        </Link>
      </p>
      <PageTitle title="Add person" subtitle="Create a person on file and, if you want, let them sign in with their Microsoft work account." />

      {access === 'checking' ? <LoadingCard testId="access-checking" label="Checking access" /> : null}
      {access === 'denied' ? <NotAvailable testId="new-denied" /> : null}

      {access === 'allowed' ? (
      <form className="card card-pad pm-form" onSubmit={submit} noValidate data-testid="person-form" aria-busy={busy}>
        {banner ? (
          <div ref={errRef} tabIndex={-1} className="pm-banner" data-testid="form-error">
            <Alert tone="danger">{banner}</Alert>
          </div>
        ) : null}

        <h2 className="pm-h2">Details</h2>
        <PersonFields form={form} onChange={setForm} errors={errors} disabled={busy} now={now} prefix="new" />

        <h2 className="pm-h2 pm-h2-gap">Profile</h2>
        <p className="pm-lead">Optional. Add what you have now and fill in the rest later on the person's page.</p>
        <ProfileNewSections form={profile} onChange={setProfile} errors={errors} disabled={busy} />

        <h2 className="pm-h2 pm-h2-gap">Sign-in and roles</h2>
        <label className="pm-check pm-check-box" htmlFor="new-can-sign-in">
          <input
            id="new-can-sign-in"
            type="checkbox"
            checked={form.can_sign_in}
            disabled={busy}
            onChange={(e) => setForm({ ...form, can_sign_in: e.target.checked, roles: e.target.checked ? form.roles : { Manager: false, HRAdmin: false, Finance: false } })}
            data-testid="input-can-sign-in"
          />
          <span>
            <strong>Can sign in with Microsoft</strong>
            <span className="pm-help" data-testid="sign-in-explain">
              {SIGN_IN_EXPLAIN}
            </span>
          </span>
        </label>
        {errors.can_sign_in ? <p className="pm-field-error" role="alert">{errors.can_sign_in}</p> : null}
        {form.can_sign_in ? (
          <>
            <RolesFields roles={form.roles} onChange={(roles) => setForm({ ...form, roles })} disabled={busy} idPrefix="new-role" />
            {errors.roles ? <p className="pm-field-error" role="alert" data-testid="roles-error">{errors.roles}</p> : null}
          </>
        ) : (
          <Notice testId="no-account-note">Without sign-in the person is on file only (for example in the directory and as a manager) and has no roles. You can allow sign-in later.</Notice>
        )}

        <div className="pm-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-person">
            {busy ? 'Adding...' : 'Add person'}
          </button>
          <Link to="/people" className="btn btn-secondary" data-testid="cancel-create">
            Cancel
          </Link>
        </div>
      </form>
      ) : null}
    </div>
  )
}
