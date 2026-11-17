import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { EmptyState } from '@/ui/EmptyState'
import { learningApi, type Compliance, type ComplianceCourse, type Course } from './api'
import { AssignPanel } from './AssignPanel'
import { CourseAdmin } from './CourseAdmin'
import { useLoad, type LearnConfigState } from './hooks'
import { ErrorBlock, LoadingCard, Pill, ProgressBar, Tabs } from './parts'
import { ReviewQueue, ScopedEnrolments } from './TeamTab'
import { statusLabel } from './logic'

type Section = 'compliance' | 'courses' | 'enrolments'
const SECTIONS: Section[] = ['compliance', 'courses', 'enrolments']
const SECTION_LABEL: Record<Section, string> = { compliance: 'Compliance', courses: 'Courses', enrolments: 'All enrolments' }

export function HrTab({ cfg, onChanged }: { cfg: LearnConfigState; onChanged?: () => void }) {
  const [params, setParams] = useSearchParams()
  const section = SECTIONS.find((s) => s === params.get('section')) ?? 'compliance'
  const [assigning, setAssigning] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const courses = useLoad<Course[]>(() => learningApi.courses({ page_size: 50 }).then((r) => r.data.items), [tick], 'The courses could not be loaded.')
  const assignable = (courses.data ?? []).filter((c) => c.allowed_actions.includes('assign'))
  const bump = () => {
    setTick((t) => t + 1)
    onChanged?.()
  }

  return (
    <section aria-labelledby="hr-title" data-testid="learning-hr">
      <div className="ln-toolbar">
        <h2 id="hr-title" className="ln-section-title">
          HR learning
        </h2>
        <div className="ln-toolbar-right">
          {!assigning ? (
            <button type="button" className="btn btn-primary" onClick={() => setAssigning(true)} disabled={courses.loading || assignable.length === 0} data-testid="hr-assign">
              <UserPlus size={16} aria-hidden="true" /> Assign a course
            </button>
          ) : null}
        </div>
      </div>
      {flash ? (
        <p className="ln-flash" role="status" data-testid="hr-flash">
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

      <ReviewQueue reloadKey={tick} onChanged={bump} />

      <Tabs
        tabs={SECTIONS.map((s) => ({ id: s, label: SECTION_LABEL[s] }))}
        active={section}
        onSelect={(s) => {
          const p = new URLSearchParams(params)
          p.set('tab', 'hr')
          if (s === 'compliance') p.delete('section')
          else p.set('section', s)
          setParams(p, { replace: true })
        }}
        label="HR sections"
        testPrefix="hr-section"
      />
      {section === 'compliance' ? <ComplianceView reloadKey={tick} /> : null}
      {section === 'courses' ? <CourseAdmin limits={cfg.limits} onChanged={bump} /> : null}
      {section === 'enrolments' ? <ScopedEnrolments scope="all" reloadKey={tick} title="All enrolments" /> : null}
    </section>
  )
}

function ComplianceView({ reloadKey }: { reloadKey: number }) {
  const [courseId, setCourseId] = useState('')
  const [department, setDepartment] = useState('')
  const [allCourses, setAllCourses] = useState<Array<{ id: string; title: string }>>([])
  const [departments, setDepartments] = useState<string[]>([])
  const state = useLoad<Compliance>(
    () =>
      learningApi.compliance({ course_id: courseId, department }).then((r) => {
        // Keep the full lists once seen so the filters do not collapse after filtering.
        setAllCourses((prev) => (r.data.courses.length >= prev.length ? r.data.courses.map((c) => ({ id: c.course_id, title: c.title })) : prev))
        setDepartments((prev) => (r.data.departments.length >= prev.length ? r.data.departments : prev))
        return r.data
      }),
    [courseId, department, reloadKey],
    'The compliance overview could not be loaded.',
  )
  const d = state.data

  return (
    <section className="ln-subsection" aria-labelledby="compliance-title" data-testid="compliance">
      <h3 id="compliance-title" className="ln-card-title">
        Mandatory course compliance
      </h3>
      <p className="ln-help" data-testid="compliance-note">
        Counts mandatory enrolments only. A completion that still waits for confirmation does not count as complete. Names appear here for HR only.
      </p>
      <div className="ln-filters">
        <label className="ln-filter-field">
          <span className="ln-label">Course</span>
          <select className="ln-input ln-select" value={courseId} onChange={(e) => setCourseId(e.target.value)} data-testid="compliance-course">
            <option value="">All mandatory courses</option>
            {allCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ln-filter-field">
          <span className="ln-label">Department</span>
          <select className="ln-input ln-select" value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="compliance-department">
            <option value="">All departments</option>
            {departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? (
        <ErrorBlock message={state.error.status === 403 ? 'The compliance overview is only available to HR administrators.' : state.error.detail} onRetry={state.reload} />
      ) : !d ? (
        <LoadingCard />
      ) : (
        <>
          <div className="card card-pad" data-testid="compliance-totals">
            <div className="ln-card-head">
              <h3 className="ln-card-title">Overall</h3>
              <span className="ln-pct" data-testid="totals-pct">
                {d.totals.completion_pct}% complete
              </span>
            </div>
            <ProgressBar value={d.totals.completion_pct} label="Overall mandatory completion" />
            <ul className="ln-stat-row">
              <li className="ln-stat">
                <span className="ln-stat-num" data-testid="totals-assigned">{d.totals.assigned}</span>
                <span className="ln-stat-label">Mandatory enrolments</span>
              </li>
              <li className="ln-stat">
                <span className="ln-stat-num" data-testid="totals-completed">{d.totals.completed}</span>
                <span className="ln-stat-label">Completed</span>
              </li>
              <li className={`ln-stat${d.totals.overdue ? ' ln-stat-alert' : ''}`}>
                <span className="ln-stat-num" data-testid="totals-overdue">{d.totals.overdue}</span>
                <span className="ln-stat-label">Overdue</span>
              </li>
              <li className="ln-stat">
                <span className="ln-stat-num" data-testid="totals-pending">{d.totals.pending_confirmation}</span>
                <span className="ln-stat-label">Waiting for confirmation</span>
              </li>
            </ul>
            <p className="ln-fine">As of {formatDate(d.as_of)}</p>
          </div>

          {d.courses.length === 0 ? (
            <EmptyState plain icon={<ShieldCheck size={24} />} title="No mandatory courses yet" body="Mandatory courses and their completion appear here once a mandatory enrolment exists." />
          ) : (
            <ul className="ln-rows" data-testid="compliance-courses">
              {d.courses.map((c) => (
                <li key={c.course_id}>
                  <CourseCompliance c={c} />
                </li>
              ))}
            </ul>
          )}

          <h3 className="ln-card-title ln-spaced">Overdue ({d.overdue_total})</h3>
          {d.overdue.length === 0 ? (
            <p className="ln-muted" data-testid="no-overdue">
              Nobody has an overdue mandatory course.
            </p>
          ) : (
            <>
              <ul className="ln-rows" data-testid="overdue-list">
                {d.overdue.map((o) => (
                  <li key={o.enrolment_id}>
                    <Link to={`/learning/enrolments/${encodeURIComponent(o.enrolment_id)}`} className="ln-row card" data-testid="overdue-row" data-id={o.enrolment_id}>
                      <div className="ln-row-main">
                        <strong className="ln-row-title" data-testid="overdue-person">
                          {o.employee_name}
                        </strong>
                        <div className="ln-sub">{[o.department, o.course_title].filter(Boolean).join(' - ')}</div>
                      </div>
                      <div className="ln-row-side">
                        <div className="ln-row-pills">
                          <Pill tone="red">{o.days_overdue === 1 ? '1 day overdue' : `${o.days_overdue} days overdue`}</Pill>
                          <Pill tone="neutral">{statusLabel(o.status)}</Pill>
                        </div>
                        <div className="ln-row-meta ln-overdue">Due {formatDate(o.due_date)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {d.overdue_total > d.overdue.length ? (
                <p className="ln-fine" data-testid="overdue-capped">
                  Showing the {d.overdue.length} most overdue of {d.overdue_total}.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  )
}

function CourseCompliance({ c }: { c: ComplianceCourse }) {
  return (
    <article className="card card-pad ln-period" data-testid="compliance-course-card" data-id={c.course_id}>
      <div className="ln-card-head">
        <h4 className="ln-card-title">{c.title}</h4>
        <span className="ln-pct" data-testid="course-pct">
          {c.completion_pct}% complete
        </span>
      </div>
      <ProgressBar value={c.completion_pct} label={`Completion for ${c.title}`} />
      <ul className="ln-stat-row">
        <li className="ln-stat">
          <span className="ln-stat-num" data-testid="course-assigned">{c.assigned}</span>
          <span className="ln-stat-label">Assigned</span>
        </li>
        <li className="ln-stat">
          <span className="ln-stat-num" data-testid="course-completed">{c.completed}</span>
          <span className="ln-stat-label">Completed</span>
        </li>
        <li className="ln-stat">
          <span className="ln-stat-num" data-testid="course-overdue">{c.overdue}</span>
          <span className="ln-stat-label">Overdue</span>
        </li>
        <li className="ln-stat">
          <span className="ln-stat-num" data-testid="course-not-enrolled">{c.mandatory_default ? c.not_enrolled : '-'}</span>
          <span className="ln-stat-label">Not enrolled yet</span>
        </li>
      </ul>
      {c.pending_confirmation > 0 ? <p className="ln-fine">{c.pending_confirmation} completed, waiting for confirmation.</p> : null}
      {c.by_department.length > 0 ? (
        <div className="ln-dept">
          <h5 className="ln-subhead">By department</h5>
          <ul className="ln-dept-list">
            {c.by_department.map((x) => (
              <li key={x.department} className="ln-dept-row">
                <span className="ln-dept-name">{x.department}</span>
                <span className="ln-dept-nums">
                  {x.completed} of {x.assigned} complete ({x.completion_pct}%)
                  {x.overdue > 0 ? `, ${x.overdue} overdue` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}
