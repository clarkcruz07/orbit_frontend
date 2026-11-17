import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, UserRoundX } from 'lucide-react'
import { directoryApi, type DirectoryProfile as Profile } from '@/api/directory'
import { Avatar } from '@/components/Avatar'
import { initialsOf } from '@/lib/authLogic'
import { formatDate } from '@/lib/dates'
import { employmentTypeLabel, personStatusLabel, personStatusTone } from '@/lib/people'
import { useAuthStore } from '@/stores/authStore'
import { EmptyState } from '@/ui/EmptyState'
import { Alert, Skeleton } from '@/ui/Feedback'
import { PageTitle } from '../PageTitle'
import '../pages.css'
import '../reimbursements/reimbursements.css'
import './directory.css'

type Load = { kind: 'loading' } | { kind: 'ready'; person: Profile } | { kind: 'missing' } | { kind: 'error'; message: string }

/** One person from the Directory. HR-only facts render only when the server sent them. */
export function DirectoryProfile() {
  const { employeeId = '' } = useParams()
  const location = useLocation()
  const myEmployeeId = useAuthStore((s) => s.user?.employee_id)
  const [loaded, setLoad] = useState<Load>({ kind: 'loading' })
  // The effect runs after the render for a new address, so for one frame `loaded` still holds the PREVIOUS person: never show it under the new URL.
  const load: Load = loaded.kind === 'ready' && loaded.person.employee_id !== employeeId ? { kind: 'loading' } : loaded
  const from = (location.state as { from?: string } | null)?.from
  const backTo = `/directory${typeof from === 'string' && from.startsWith('?') ? from : ''}`

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    directoryApi
      .get(employeeId)
      .then((person) => live && setLoad({ kind: 'ready', person }))
      .catch((e: { response?: { status?: number } }) => {
        if (!live) return
        const status = e?.response?.status
        if (status === 404) setLoad({ kind: 'missing' })
        else setLoad({ kind: 'error', message: status ? 'This profile could not be loaded.' : "Can't reach the Bluedge People service." })
      })
    return () => {
      live = false
    }
  }, [employeeId])

  useEffect(() => run(), [run])

  const back = (
    <p className="r-back">
      <Link to={backTo} className="r-back-link" data-testid="dir-back">
        <ArrowLeft size={16} aria-hidden="true" /> Back to directory
      </Link>
    </p>
  )

  if (load.kind === 'missing') {
    return (
      <div className="page dir-page">
        {back}
        <EmptyState
          icon={<UserRoundX size={28} />}
          title="We can't find that person"
          body="They may have left, or the address may be mistyped."
          action={
            <Link to="/directory" className="btn btn-primary">
              Browse the directory
            </Link>
          }
        />
      </div>
    )
  }

  if (load.kind === 'loading' || load.kind === 'error') {
    return (
      <div className="page dir-page">
        {back}
        <PageTitle title="Profile" subtitle="Colleague details from the directory." />
        {load.kind === 'error' ? (
          <div data-testid="dir-profile-error">
            <Alert tone="danger">{load.message}</Alert>
            <button type="button" className="btn btn-secondary r-retry" onClick={() => run()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="card card-pad" aria-busy="true" data-testid="dir-profile-loading">
            <Skeleton style={{ height: 64, width: 64, borderRadius: 32, marginBottom: 14 }} />
            <Skeleton style={{ height: 16, width: '50%', marginBottom: 10 }} />
            <Skeleton style={{ height: 14, width: '70%' }} />
          </div>
        )}
      </div>
    )
  }

  const p = load.person
  const hasHr = 'employment_type' in p || 'start_date' in p || 'status' in p
  const isMe = Boolean(myEmployeeId) && myEmployeeId === p.employee_id

  return (
    <div className="page dir-page" data-testid="dir-profile" data-id={p.employee_id}>
      {back}
      <PageTitle title={p.name} subtitle={[p.job_title, p.department].filter(Boolean).join(' - ') || 'Colleague details from the directory.'} />
      <section className="card" aria-label="Profile">
        <div className="profile-card">
          <Avatar name={p.name} initials={p.avatar_initials ?? initialsOf(p.name)} size={84} />
          <div>
            <h2>{p.name}</h2>
            <p className="profile-role-line">{p.job_title ?? '-'}</p>
            {isMe ? (
              <p className="dir-me-link">
                <Link to="/my-profile">This is you - open My Profile</Link>
              </p>
            ) : null}
          </div>
        </div>
        <dl className="profile-facts" data-testid="dir-facts">
          <div>
            <dt>Email</dt>
            <dd>{p.email ? <a href={`mailto:${p.email}`} className="dir-mail">{p.email}</a> : '-'}</dd>
          </div>
          <div>
            <dt>Employee ID</dt>
            <dd>{p.employee_id}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{p.department ?? '-'}</dd>
          </div>
          <div>
            <dt>Job title</dt>
            <dd>{p.job_title ?? '-'}</dd>
          </div>
          <div data-testid="dir-manager">
            <dt>Manager</dt>
            <dd>
              {p.manager ? (
                <Link to={`/directory/${encodeURIComponent(p.manager.employee_id)}`} className="r-row-link">
                  {p.manager.name}
                </Link>
              ) : (
                'No manager'
              )}
            </dd>
          </div>
          {hasHr ? (
            <>
              <div data-testid="dir-hr-employment">
                <dt>Employment type</dt>
                <dd>{employmentTypeLabel(p.employment_type)}</dd>
              </div>
              <div>
                <dt>Start date</dt>
                <dd>{formatDate(p.start_date)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`r-pill r-pill-${personStatusTone(p.status)}`}>{personStatusLabel(p.status)}</span>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </section>

      <section className="card card-pad dir-reports" aria-labelledby="dir-reports-h" data-testid="dir-reports">
        <h2 id="dir-reports-h">Direct reports</h2>
        {p.direct_reports.length === 0 ? (
          <p className="r-muted dir-reports-empty">{p.name} has no direct reports.</p>
        ) : (
          <ul className="dir-report-list">
            {p.direct_reports.map((d) => (
              <li key={d.employee_id}>
                <Link to={`/directory/${encodeURIComponent(d.employee_id)}`} className="dir-report" data-testid="dir-report">
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
    </div>
  )
}
