import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ShieldOff, UserRoundX } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { type Person, parseFailure, peopleApi } from './api'
import { MICROSOFT_PILL_TITLE, isEntraSource, leftDirectoryHint } from './entraSync'
import {
  accountBadge,
  birthdayLabel,
  buildPatchBody,
  employmentLabel,
  failureMessage,
  fieldErrorsText,
  formFromPerson,
  formatDate,
  initialsOf,
  isEmptyPatch,
  statusLabel,
  statusTone,
  validatePersonForm,
  type FieldErrors,
  type PersonForm,
} from './logic'
import { AccountCard } from './AccountCard'
import { DeactivateDialog, ReactivateDialog, SignInOffDialog } from './PersonDialogs'
import { PersonFields } from './PersonFields'
import { ProfileSectionCard } from './ProfileParts'
import { dateOfBirth } from './profileLogic'
import { PROFILE_SECTIONS } from '@/api/profile'
import { ErrorBlock, LoadingCard, Pill } from './parts'
import '@/pages/pages.css'
import './peoplemgmt.css'

type Load = { kind: 'loading' } | { kind: 'ready'; person: Person } | { kind: 'missing' } | { kind: 'denied' } | { kind: 'error'; message: string }
type Dialog = null | 'deactivate' | 'reactivate' | 'signin-off'

/** An account whose e-mail comes from configuration (the Microsoft sign-in user list or the demo seed): the server refuses changes (409 email_managed). */
const emailIsManaged = (p: Person): boolean => p.account.has_account && (p.account.source === 'entra_bootstrap' || p.account.source === 'demo')

/** HR: one person. View, edit details, account and roles, deactivate and reactivate. */
export function PersonDetail() {
  const { employeeId = '' } = useParams()
  const location = useLocation()
  const justCreated = Boolean((location.state as { created?: boolean } | null)?.created)
  const now = useMemo(() => new Date(), [])
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PersonForm | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    peopleApi
      .get(employeeId)
      .then((person) => live && setLoad({ kind: 'ready', person }))
      .catch((err) => {
        if (!live) return
        const f = parseFailure(err)
        if (f.status === 404) setLoad({ kind: 'missing' })
        else if (f.status === 403) setLoad({ kind: 'denied' })
        else setLoad({ kind: 'error', message: failureMessage(f, 'This person could not be loaded.') })
      })
    return () => {
      live = false
    }
  }, [employeeId])

  useEffect(() => run(), [run])
  useEffect(() => {
    setEditing(false)
    setNotice(justCreated ? 'Person added. If sign-in is on, they can sign in with their Microsoft work account once the email address matches.' : null)
  }, [employeeId, justCreated])

  const back = (
    <p className="pm-back">
      <Link to="/people" className="pm-back-link" data-testid="back-to-people">
        <ArrowLeft size={16} aria-hidden="true" /> Back to people
      </Link>
    </p>
  )

  if (load.kind === 'missing') {
    return (
      <div className="page pm-page" data-testid="person-missing">
        {back}
        <EmptyState
          icon={<UserRoundX size={28} />}
          title="We can't find that person"
          body="The address may be mistyped. People are never deleted, so anyone who ever existed can be found in the list."
          action={
            <Link to="/people" className="btn btn-primary">
              Back to people
            </Link>
          }
        />
      </div>
    )
  }
  if (load.kind === 'denied') {
    return (
      <div className="page pm-page" data-testid="person-denied">
        {back}
        <EmptyState icon={<ShieldOff size={28} />} title="People management is not available" body="This page is for HR administrators. Your account does not have access to it." />
      </div>
    )
  }
  if (load.kind === 'loading' || load.kind === 'error') {
    return (
      <div className="page pm-page">
        {back}
        <PageTitle title="Person" subtitle="Details, account and roles." />
        {load.kind === 'error' ? <ErrorBlock message={load.message} onRetry={() => run()} testId="person-error" /> : <LoadingCard testId="person-loading" label="Loading person" />}
      </div>
    )
  }

  const person = load.person
  const e = person.employee
  const badge = accountBadge(person)
  const left = e.status === 'left'
  const dob = dateOfBirth(e.birthday, e.profile.personal.birth_year)

  function apply(next: Person, message: string) {
    setLoad({ kind: 'ready', person: next })
    setNotice(message)
    setDialog(null)
  }

  function startEdit() {
    setForm(formFromPerson(person))
    setErrors({})
    setBanner(null)
    setEditing(true)
  }

  async function save(ev: FormEvent) {
    ev.preventDefault()
    if (!form || saving) return
    const local = validatePersonForm(form, now, { selfId: e.employee_id })
    if (Object.keys(local).length) {
      setErrors(local)
      setBanner('Please fix the highlighted fields.')
      return
    }
    const body = buildPatchBody(person, form)
    if (isEmptyPatch(body)) {
      setEditing(false)
      setNotice('No changes to save.')
      return
    }
    setSaving(true)
    setErrors({})
    setBanner(null)
    try {
      const next = await peopleApi.update(e.employee_id, body)
      setLoad({ kind: 'ready', person: next })
      setEditing(false)
      setNotice('Details saved.')
    } catch (err) {
      const f = parseFailure(err)
      if (f.status === 409 && (f.code === 'email_exists' || f.code === 'email_managed')) {
        setErrors({ email: failureMessage(f, '') })
      } else if (f.status === 422 && Object.keys(f.fieldErrors).length) {
        setErrors(fieldErrorsText(f.fieldErrors))
        setBanner('The service did not accept some values. See the highlighted fields.')
      } else {
        setBanner(failureMessage(f, 'The details could not be saved.'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page pm-page" data-testid="person-detail" data-id={e.employee_id} data-status={e.status}>
      {back}
      <PageTitle title={e.name} subtitle={[e.job_title, e.department].filter(Boolean).join(' - ') || 'Details, account and roles.'} />

      {notice ? (
        <div className="pm-notice-row" data-testid="detail-notice">
          <Alert tone="info">{notice}</Alert>
        </div>
      ) : null}

      <div className="pm-detail-grid">
        <section className="card card-pad pm-card-section" aria-labelledby="pm-details-h" data-testid="details-card">
          <div className="pm-section-head">
            <div className="pm-id">
              <Avatar name={e.name} initials={e.avatar_initials || initialsOf(e.name)} size={56} />
              <div className="pm-id-text">
                <h2 className="pm-h2" id="pm-details-h">
                  Details
                </h2>
                <span className="pm-card-pills">
                  <Pill tone={statusTone(e.status)} testId="status-pill">
                    {statusLabel(e.status)}
                  </Pill>
                  <Pill tone={badge.tone}>{badge.label}</Pill>
                  {isEntraSource(e.source) ? (
                    <Pill tone="violet" testId="source-pill" title={MICROSOFT_PILL_TITLE}>
                      Microsoft
                    </Pill>
                  ) : null}
                </span>
                {leftDirectoryHint(e) ? (
                  <span className="pm-sub" data-testid="left-directory-hint">
                    {leftDirectoryHint(e)}
                  </span>
                ) : null}
              </div>
            </div>
            {!editing ? (
              <button type="button" className="btn btn-secondary" onClick={startEdit} data-testid="edit-details">
                Edit details
              </button>
            ) : null}
          </div>

          {editing && form ? (
            <form onSubmit={save} noValidate data-testid="edit-form" aria-busy={saving}>
              {banner ? (
                <div className="pm-banner" data-testid="form-error">
                  <Alert tone="danger">{banner}</Alert>
                </div>
              ) : null}
              <PersonFields form={form} onChange={setForm} errors={errors} disabled={saving} now={now} selfId={e.employee_id} emailLocked={emailIsManaged(person)} prefix="edit" />
              <div className="pm-actions">
                <button type="submit" className="btn btn-primary" disabled={saving} data-testid="save-details">
                  {saving ? 'Saving...' : 'Save details'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving} data-testid="cancel-edit">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <dl className="pm-facts" data-testid="details-facts">
              <div>
                <dt>Email</dt>
                <dd className="pm-wrap" data-testid="fact-email">
                  {e.email || '-'}
                </dd>
              </div>
              <div>
                <dt>Employee ID</dt>
                <dd className="pm-wrap">{e.employee_id}</dd>
              </div>
              <div>
                <dt>Job title</dt>
                <dd className="pm-wrap" data-testid="fact-job_title">{e.job_title || '-'}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd className="pm-wrap" data-testid="fact-department">{e.department || '-'}</dd>
              </div>
              <div>
                <dt>Employment type</dt>
                <dd>{employmentLabel(e.employment_type)}</dd>
              </div>
              <div data-testid="fact-manager">
                <dt>Manager</dt>
                <dd className="pm-wrap">
                  {e.manager ? (
                    <Link to={`/people/${encodeURIComponent(e.manager.employee_id)}`} className="pm-link">
                      {e.manager.name}
                    </Link>
                  ) : (
                    'No manager'
                  )}
                </dd>
              </div>
              <div>
                <dt>Start date</dt>
                <dd>{formatDate(e.start_date)}</dd>
              </div>
              <div>
                <dt data-testid="fact-birthday-label">{dob?.label ?? 'Birthday'}</dt>
                <dd data-testid="fact-birthday">
                  {dob ? dob.value : birthdayLabel(e.birthday)}
                  {e.birthday && !e.profile.personal.birth_year ? <span className="pm-sub">Day and month only</span> : null}
                  {e.profile.personal.birth_year ? <span className="pm-sub">The calendar never shows the year.</span> : null}
                </dd>
              </div>
              {left ? (
                <div data-testid="fact-end-date">
                  <dt>Left on</dt>
                  <dd>{formatDate(e.end_date)}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>

        <AccountCard person={person} onChanged={apply} onAskSignInOff={() => setDialog('signin-off')} />
      </div>

      <h2 className="pm-h2 pm-profile-heading" data-testid="profile-heading">
        Profile
      </h2>
      <div className="pm-profile-grid" data-testid="profile-cards">
        {PROFILE_SECTIONS.map((s) => (
          <ProfileSectionCard
            key={s.id}
            section={s.id}
            profile={e.profile}
            mode="hr"
            save={async (body) => {
              const next = await peopleApi.update(e.employee_id, body)
              setLoad({ kind: 'ready', person: next })
            }}
            onSaved={(title) => setNotice(`${title} saved.`)}
          />
        ))}
      </div>

      <section className="card card-pad pm-card-section pm-leaving" aria-labelledby="pm-leaving-h" data-testid="leaving-card">
        <h2 className="pm-h2" id="pm-leaving-h">
          {left ? 'Reactivate' : 'Leaving the company'}
        </h2>
        {left ? (
          <>
            <p className="pm-lead">{e.name} is marked as left. Reactivating makes them active again and, if their sign-in was turned off by the deactivation, turns it back on.</p>
            <button type="button" className="btn btn-primary" onClick={() => setDialog('reactivate')} data-testid="reactivate">
              Reactivate
            </button>
          </>
        ) : (
          <>
            <p className="pm-lead">Deactivating signs the person out straight away and blocks sign-in. Their history is kept and nothing is deleted.</p>
            <button type="button" className="btn pm-btn-danger" onClick={() => setDialog('deactivate')} data-testid="deactivate">
              Deactivate
            </button>
          </>
        )}
      </section>

      {dialog === 'deactivate' ? <DeactivateDialog person={person} onClose={() => setDialog(null)} onDone={apply} /> : null}
      {dialog === 'reactivate' ? <ReactivateDialog person={person} onClose={() => setDialog(null)} onDone={apply} /> : null}
      {dialog === 'signin-off' ? <SignInOffDialog person={person} onClose={() => setDialog(null)} onDone={apply} /> : null}
    </div>
  )
}
