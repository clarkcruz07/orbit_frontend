import { useState } from 'react'
import { CheckCircle2, UserPlus, Users } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { learningApi, type Course, type Enrolment, type Page, type TeamSummary } from './api'
import { AssignPanel } from './AssignPanel'
import { useLoad } from './hooks'
import { EnrolmentRows } from './lists'
import { ErrorBlock, LoadingCard, Pager, Pill } from './parts'
import { STATUSES, personName, statusLabel } from './logic'

const PAGE_SIZE = 20

/** Waiting-for-confirmation queue. Shared by the Team and HR tabs; the rows' buttons come from allowed_actions. */
export function ReviewQueue({ reloadKey = 0, onChanged }: { reloadKey?: number; onChanged?: () => void }) {
  const [page, setPage] = useState(1)
  const list = useLoad<Page<Enrolment>>(() => learningApi.enrolments({ scope: 'review', page, page_size: PAGE_SIZE }).then((r) => r.data), [page, reloadKey], 'The completions waiting for you could not be loaded.')
  const d = list.data
  return (
    <section className="ln-subsection" aria-labelledby="review-title" data-testid="review-queue">
      <h3 id="review-title" className="ln-card-title">
        Waiting for your confirmation {d ? `(${d.total})` : ''}
      </h3>
      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : !d ? (
        <LoadingCard rows={2} />
      ) : d.items.length === 0 ? (
        <EmptyState plain icon={<CheckCircle2 size={24} />} title="Nothing is waiting for you" body="Completions that need your confirmation appear here." />
      ) : (
        <>
          <EnrolmentRows
            items={d.items}
            showOwner
            review
            onChanged={() => {
              list.reload()
              onChanged?.()
            }}
          />
          <Pager page={d.page} total={d.total} pageSize={d.page_size} onPage={setPage} />
        </>
      )}
    </section>
  )
}

/** A filterable list of enrolments for a scope (team: direct reports; all: HR). */
export function ScopedEnrolments({ scope, reloadKey = 0, title }: { scope: 'team' | 'all'; reloadKey?: number; title: string }) {
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [mandatory, setMandatory] = useState(false)
  const [page, setPage] = useState(1)
  const list = useLoad<Page<Enrolment>>(
    () => learningApi.enrolments({ scope, status, overdue: overdue || undefined, mandatory: mandatory || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [scope, status, overdue, mandatory, page, reloadKey],
    'The enrolments could not be loaded.',
  )
  const filtered = Boolean(status || overdue || mandatory)
  const d = list.data
  return (
    <section className="ln-subsection" aria-labelledby={`scoped-${scope}-title`} data-testid={`scoped-${scope}`}>
      <h3 id={`scoped-${scope}-title`} className="ln-card-title">
        {title} {d ? `(${d.total})` : ''}
      </h3>
      <div className="ln-filters">
        <label className="ln-filter-field">
          <span className="ln-label">Status</span>
          <select
            className="ln-input ln-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            data-testid={`${scope}-status`}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="ln-check ln-check-inline">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => {
              setOverdue(e.target.checked)
              setPage(1)
            }}
            data-testid={`${scope}-overdue`}
          />
          <span>Overdue only</span>
        </label>
        <label className="ln-check ln-check-inline">
          <input
            type="checkbox"
            checked={mandatory}
            onChange={(e) => {
              setMandatory(e.target.checked)
              setPage(1)
            }}
            data-testid={`${scope}-mandatory`}
          />
          <span>Mandatory only</span>
        </label>
      </div>
      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : !d ? (
        <LoadingCard />
      ) : d.items.length === 0 ? (
        <EmptyState plain icon={<Users size={24} />} title={filtered ? 'Nothing matches these filters' : 'No enrolments to show'} body={filtered ? 'Try clearing a filter.' : 'Enrolments appear here once courses are assigned or taken.'} />
      ) : (
        <>
          <EnrolmentRows items={d.items} showOwner />
          <Pager page={d.page} total={d.total} pageSize={d.page_size} onPage={setPage} />
        </>
      )}
    </section>
  )
}

export function TeamTab({ onChanged }: { onChanged?: () => void }) {
  const summary = useLoad<TeamSummary>(() => learningApi.teamSummary().then((r) => r.data), [], 'The team summary could not be loaded.')
  const courses = useLoad<Course[]>(() => learningApi.courses({ page_size: 50 }).then((r) => r.data.items), [], 'The courses could not be loaded.')
  const [assigning, setAssigning] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const bump = () => {
    setTick((t) => t + 1)
    summary.reload()
    onChanged?.()
  }
  const assignable = (courses.data ?? []).filter((c) => c.allowed_actions.includes('assign'))

  return (
    <section aria-labelledby="team-title" data-testid="learning-team">
      <div className="ln-toolbar">
        <h2 id="team-title" className="ln-section-title">
          Team learning
        </h2>
        <div className="ln-toolbar-right">
          {!assigning ? (
            <button type="button" className="btn btn-primary" onClick={() => setAssigning(true)} disabled={courses.loading || assignable.length === 0} data-testid="team-assign">
              <UserPlus size={16} aria-hidden="true" /> Assign a course
            </button>
          ) : null}
        </div>
      </div>

      {flash ? (
        <p className="ln-flash" role="status" data-testid="team-flash">
          {flash}
        </p>
      ) : null}
      {assigning ? (
        <AssignPanel
          courses={assignable}
          onCancel={() => setAssigning(false)}
          onDone={(e) => {
            setAssigning(false)
            setFlash(`Assigned ${e.course.title} to ${e.employee.name ?? e.employee.employee_id}.`)
            bump()
          }}
        />
      ) : null}

      <section className="ln-subsection" aria-labelledby="team-summary-title">
        <h3 id="team-summary-title" className="ln-card-title">
          Your direct reports {summary.data ? `(${summary.data.total})` : ''}
        </h3>
        {summary.error ? (
          <ErrorBlock message={summary.error.detail} onRetry={summary.reload} />
        ) : !summary.data ? (
          <LoadingCard />
        ) : summary.data.items.length === 0 ? (
          <EmptyState plain icon={<Users size={24} />} title="You have no direct reports on record" body="People who report to you appear here with their learning progress." />
        ) : (
          <ul className="ln-rows" data-testid="team-summary">
            {summary.data.items.map((r) => (
              <li key={r.employee.employee_id}>
                <div className="ln-row ln-row-static card" data-testid="team-row" data-id={r.employee.employee_id}>
                  <div className="ln-row-main">
                    <strong className="ln-row-title ln-row-title-plain">{personName(r.employee)}</strong>
                    <div className="ln-sub">{[r.employee.job_title, r.employee.department].filter(Boolean).join(' - ')}</div>
                  </div>
                  <div className="ln-row-side">
                    <div className="ln-row-pills">
                      <Pill tone="neutral" testId="pill-to-start">
                        {r.assigned + r.enrolled} to start
                      </Pill>
                      <Pill tone="blue" testId="pill-in-progress">
                        {r.in_progress} in progress
                      </Pill>
                      <Pill tone="green" testId="pill-completed">
                        {r.completed} completed
                      </Pill>
                      {r.overdue > 0 ? (
                        <Pill tone="red" testId="pill-overdue">
                          {r.overdue} overdue
                        </Pill>
                      ) : null}
                      {r.pending_confirmation > 0 ? (
                        <Pill tone="amber" testId="pill-pending">
                          {r.pending_confirmation} to confirm
                        </Pill>
                      ) : null}
                    </div>
                    {r.mandatory_open > 0 ? <div className="ln-row-meta">{r.mandatory_open} mandatory still open</div> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewQueue reloadKey={tick} onChanged={bump} />
      <ScopedEnrolments scope="team" reloadKey={tick} title="Team enrolments" />
    </section>
  )
}
