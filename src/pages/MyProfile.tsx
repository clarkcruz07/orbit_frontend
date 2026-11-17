import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Cake } from 'lucide-react'
import { meApi, type MyProfileData } from '@/api/me'
import { Avatar } from '@/components/Avatar'
import { initialsOf } from '@/lib/authLogic'
import { formatDate } from '@/lib/dates'
import { authSourceLabel, employmentTypeLabel, personStatusLabel, personStatusTone, rolesText } from '@/lib/people'
import { Alert, Skeleton } from '@/ui/Feedback'
import { MyProfileSections } from './MyProfileSections'
import { dateOfBirthFromLabel } from '@/modules/peoplemgmt/profileLogic'
import { PageTitle } from './PageTitle'
import './pages.css'
import './reimbursements/reimbursements.css'
import './directory/directory.css'

type Load = { kind: 'loading' } | { kind: 'ready'; profile: MyProfileData } | { kind: 'error'; message: string }

/** My Profile: the caller's own record from GET /me/profile (always the full set of fields for yourself). */
export function MyProfile() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    meApi
      .profile()
      .then((profile) => live && setLoad({ kind: 'ready', profile }))
      .catch((e: { response?: { status?: number } }) => live && setLoad({ kind: 'error', message: e?.response?.status ? 'Your profile could not be loaded.' : "Can't reach the Bluedge People service." }))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => run(), [run])

  return (
    <div className="page dir-page">
      <PageTitle title="My Profile" subtitle="Your details as held in Bluedge People." />
      {load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="profile-loading">
          <span className="sr-only" role="status">
            Loading your profile
          </span>
          <Skeleton style={{ height: 72, width: 72, borderRadius: 36, marginBottom: 14 }} />
          <Skeleton style={{ height: 16, width: '45%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '65%' }} />
        </div>
      ) : load.kind === 'error' ? (
        <div data-testid="profile-error">
          <Alert tone="danger">{load.message}</Alert>
          <button type="button" className="btn btn-secondary r-retry" onClick={() => run()}>
            Try again
          </button>
        </div>
      ) : (
        <Ready profile={load.profile} onUpdated={(next) => setLoad({ kind: 'ready', profile: next })} />
      )}
    </div>
  )
}

function Ready({ profile, onUpdated }: { profile: MyProfileData; onUpdated: (next: MyProfileData) => void }) {
  const e = profile.employee
  const hasEmployment = 'employment_type' in e || 'start_date' in e || 'status' in e
  const start = profile.member_since ?? e.start_date ?? null
  const dob = dateOfBirthFromLabel(profile.birthday, profile.profile.personal.birth_year)
  return (
    <>
      <section className="card" aria-label="Profile" data-testid="profile-card">
        <div className="profile-card">
          <Avatar name={e.name} initials={e.avatar_initials ?? initialsOf(e.name)} size={84} />
          <div>
            <h2>{e.name}</h2>
            <p className="profile-role-line">{e.job_title ?? rolesText(profile.roles)}</p>
          </div>
        </div>
        <dl className="profile-facts" data-testid="profile-facts">
          <div>
            <dt>Email</dt>
            <dd>{e.email ?? '-'}</dd>
          </div>
          <div>
            <dt>Employee ID</dt>
            <dd>{e.employee_id || '-'}</dd>
          </div>
          {e.entra_employee_id ? (
            <div data-testid="profile-entra-id">
              <dt>Entra employee ID</dt>
              <dd>{e.entra_employee_id}</dd>
            </div>
          ) : null}
          <div>
            <dt>Job title</dt>
            <dd>{e.job_title ?? '-'}</dd>
          </div>
          {e.company ? (
            <div data-testid="profile-company">
              <dt>Company</dt>
              <dd>{e.company}</dd>
            </div>
          ) : null}
          <div>
            <dt>Department</dt>
            <dd>{e.department ?? '-'}</dd>
          </div>
          {e.office_location ? (
            <div data-testid="profile-office">
              <dt>Office location</dt>
              <dd>{e.office_location}</dd>
            </div>
          ) : null}
          <div data-testid="profile-manager">
            <dt>Manager</dt>
            <dd>
              {profile.manager ? (
                <Link to={`/directory/${encodeURIComponent(profile.manager.employee_id)}`} className="r-row-link">
                  {profile.manager.name}
                </Link>
              ) : (
                'No manager'
              )}
            </dd>
          </div>
          {hasEmployment ? (
            <>
              <div>
                <dt>Employment type</dt>
                <dd>{employmentTypeLabel(e.employment_type)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`r-pill r-pill-${personStatusTone(e.status)}`}>{personStatusLabel(e.status)}</span>
                </dd>
              </div>
            </>
          ) : null}
          <div data-testid="profile-member-since">
            <dt>Member since</dt>
            <dd>{formatDate(start)}</dd>
          </div>
          <div data-testid="profile-birthday">
            <dt data-testid="profile-birthday-label">{dob?.label ?? 'Birthday'}</dt>
            <dd>
              {dob ? (
                <span className="profile-birthday">
                  <Cake size={16} aria-hidden="true" /> {dob.value}
                </span>
              ) : (
                '-'
              )}
              <span className="r-sub" data-testid="profile-birthday-note">
                Everyone can see your birthday on the company calendar (day and month only). Your birth year is visible only to you and HR.
              </span>
            </dd>
          </div>
          <div data-testid="profile-roles">
            <dt>Role</dt>
            <dd>{rolesText(profile.roles)}</dd>
          </div>
          <div data-testid="profile-signin">
            <dt>Signed in with</dt>
            <dd>{authSourceLabel(profile.auth_source)}</dd>
          </div>
        </dl>
      </section>

      <MyProfileSections profile={profile.profile} onUpdated={(next) => onUpdated({ ...profile, ...next })} />

      <section className="card card-pad dir-reports" aria-labelledby="my-reports-h" data-testid="profile-reports">
        <h2 id="my-reports-h">Your direct reports</h2>
        {profile.direct_reports.length === 0 ? (
          <p className="r-muted dir-reports-empty">You have no direct reports.</p>
        ) : (
          <ul className="dir-report-list">
            {profile.direct_reports.map((d) => (
              <li key={d.employee_id}>
                <Link to={`/directory/${encodeURIComponent(d.employee_id)}`} className="dir-report">
                  <Avatar name={d.name} initials={initialsOf(d.name)} size={36} />
                  <span className="dir-person-text">
                    <strong>{d.name}</strong>
                    <span className="r-sub">{d.job_title ?? '-'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="profile-browse">
        <Link to="/directory" className="request-card-open" data-testid="browse-directory">
          Browse the directory <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </p>

      <div className="profile-readonly-note">
        <Alert tone="info">Your name, job title, department, manager, start date and work details are set by HR. Ask HR to change this.</Alert>
      </div>
    </>
  )
}
