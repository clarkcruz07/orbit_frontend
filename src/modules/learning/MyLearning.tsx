import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { learningApi, type MySummary } from './api'
import { useLoad } from './hooks'
import { EnrolmentRows } from './lists'
import { ErrorBlock, LoadingCard, Pager } from './parts'
import { STATUSES, statusLabel } from './logic'

const PAGE_SIZE = 20

/**
 * My learning. `GET /learning/my/summary` is called when the tab loads: besides the counts it makes the server
 * create due-soon notifications for the caller's own enrolments (once per enrolment per day).
 */
export function MyLearning({ onOpenReview }: { onOpenReview?: () => void }) {
  const summary = useLoad<MySummary>(() => learningApi.mySummary().then((r) => r.data), [], 'Your learning summary could not be loaded.')
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [mandatory, setMandatory] = useState(false)
  const [page, setPage] = useState(1)
  const list = useLoad(
    () => learningApi.enrolments({ scope: 'mine', status, overdue: overdue || undefined, mandatory: mandatory || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [status, overdue, mandatory, page],
    'Your learning could not be loaded.',
  )
  const c = summary.data?.counts
  const waiting = summary.data?.awaiting_my_confirmation ?? 0
  const filtered = Boolean(status || overdue || mandatory)

  return (
    <section aria-labelledby="mine-title" data-testid="my-learning">
      <div className="ln-toolbar">
        <h2 id="mine-title" className="ln-section-title">
          My learning
        </h2>
      </div>

      {summary.error ? (
        <p className="ln-help" data-testid="summary-error">
          {summary.error.detail}
        </p>
      ) : c ? (
        <ul className="ln-stat-row" data-testid="my-summary">
          <li className="ln-stat">
            <span className="ln-stat-num" data-testid="count-open">{c.assigned + c.enrolled + c.in_progress}</span>
            <span className="ln-stat-label">To do</span>
          </li>
          <li className={`ln-stat${c.overdue ? ' ln-stat-alert' : ''}`}>
            <span className="ln-stat-num" data-testid="count-overdue">{c.overdue}</span>
            <span className="ln-stat-label">Overdue</span>
          </li>
          <li className="ln-stat">
            <span className="ln-stat-num" data-testid="count-due-soon">{c.due_soon}</span>
            <span className="ln-stat-label">Due soon</span>
          </li>
          <li className="ln-stat">
            <span className="ln-stat-num" data-testid="count-completed">{c.completed}</span>
            <span className="ln-stat-label">Completed</span>
          </li>
        </ul>
      ) : null}
      {c && (c.mandatory_open > 0 || c.pending_confirmation > 0) ? (
        <p className="ln-help" data-testid="summary-notes">
          {c.mandatory_open > 0 ? `${c.mandatory_open} mandatory ${c.mandatory_open === 1 ? 'course is' : 'courses are'} still open. ` : ''}
          {c.pending_confirmation > 0 ? `${c.pending_confirmation} completed ${c.pending_confirmation === 1 ? 'course is' : 'courses are'} waiting for confirmation.` : ''}
        </p>
      ) : null}
      {waiting > 0 && onOpenReview ? (
        <p className="ln-flash ln-flash-amber" data-testid="awaiting-confirmation">
          {waiting} {waiting === 1 ? 'completion is' : 'completions are'} waiting for your confirmation.{' '}
          <button type="button" className="ln-linkbtn" onClick={onOpenReview} data-testid="open-review">
            Review now
          </button>
        </p>
      ) : null}

      <div className="ln-filters" data-testid="mine-filters">
        <label className="ln-filter-field">
          <span className="ln-label">Status</span>
          <select
            className="ln-input ln-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            data-testid="mine-status"
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
            data-testid="mine-overdue"
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
            data-testid="mine-mandatory"
          />
          <span>Mandatory only</span>
        </label>
      </div>

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingCard />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} />}
          title={filtered ? 'Nothing matches these filters' : 'You are not enrolled in anything yet'}
          body={filtered ? 'Try clearing a filter.' : 'Browse the catalog to enrol in a course. Courses your manager or HR assigns to you appear here too.'}
          action={
            !filtered ? (
              <Link to="/learning" className="btn btn-primary" data-testid="browse-catalog">
                Browse the catalog
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <EnrolmentRows items={list.data.items} />
          <Pager page={list.data.page} total={list.data.total} pageSize={list.data.page_size} onPage={setPage} />
        </>
      )}
    </section>
  )
}
