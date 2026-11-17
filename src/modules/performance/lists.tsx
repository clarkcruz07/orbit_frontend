import { Link } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import type { Checkin, Goal } from './api'
import { CheckinStatusPill, GoalStatusPill, Pill, ProgressBar } from './parts'
import { formatDateTime, personName, reviewerLabel } from './logic'

/** Cards on every width: a goal per row, link to its detail page. */
export function GoalRows({ goals, showOwner }: { goals: Goal[]; showOwner?: boolean }) {
  return (
    <ul className="pf-rows" data-testid="goal-list">
      {goals.map((g) => (
        <li key={g.goal_id}>
          <Link to={`/performance/goals/${encodeURIComponent(g.goal_id)}`} className="pf-row card" data-testid="goal-row" data-id={g.goal_id} data-status={g.status}>
            <div className="pf-row-main">
              <strong className="pf-row-title">{g.title}</strong>
              {showOwner ? (
                <div className="pf-sub" data-testid="goal-owner">
                  {personName(g.employee)}
                  {g.employee.department ? ` - ${g.employee.department}` : ''}
                </div>
              ) : null}
              {g.description ? <p className="pf-row-desc">{g.description}</p> : null}
            </div>
            <div className="pf-row-side">
              <div className="pf-row-pills">
                <GoalStatusPill status={g.status} />
                {g.overdue ? (
                  <Pill tone="red" testId="goal-overdue">
                    Overdue
                  </Pill>
                ) : null}
              </div>
              <div className="pf-row-progress">
                <ProgressBar value={g.progress} label={`Progress for ${g.title}`} />
                <span className="pf-progress-num" data-testid="goal-progress">
                  {g.progress}%
                </span>
              </div>
              <div className="pf-row-meta">
                <span>{g.due_date ? `Due ${formatDate(g.due_date)}` : 'No due date'}</span>
                {g.comment_count > 0 ? (
                  <span className="pf-comment-count" data-testid="goal-comment-count">
                    <MessageSquare size={14} aria-hidden="true" /> {g.comment_count}
                    <span className="pf-visually-hidden"> {g.comment_count === 1 ? 'comment' : 'comments'}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function CheckinRows({ items, showOwner }: { items: Checkin[]; showOwner?: boolean }) {
  return (
    <ul className="pf-rows" data-testid="checkin-list">
      {items.map((c) => (
        <li key={c.checkin_id}>
          <Link to={`/performance/checkins/${encodeURIComponent(c.checkin_id)}`} className="pf-row card" data-testid="checkin-row" data-id={c.checkin_id} data-status={c.status}>
            <div className="pf-row-main">
              <strong className="pf-row-title">{c.period_label}</strong>
              {showOwner ? (
                <div className="pf-sub" data-testid="checkin-owner">
                  {personName(c.employee)}
                  {c.employee.department ? ` - ${c.employee.department}` : ''}
                </div>
              ) : null}
              <div className="pf-sub">
                {c.status === 'requested'
                  ? `Requested by ${c.requested_by?.name ?? 'a manager'}${c.requested_at ? ` on ${formatDateTime(c.requested_at)}` : ''}`
                  : `Submitted ${formatDateTime(c.submitted_at)}`}
              </div>
            </div>
            <div className="pf-row-side">
              <div className="pf-row-pills">
                <CheckinStatusPill status={c.status} reviewer={c.reviewer} />
              </div>
              <div className="pf-row-meta">
                {c.status === 'acknowledged' ? (
                  <span>Acknowledged {formatDateTime(c.acknowledged_at)}</span>
                ) : c.status === 'submitted' ? (
                  <span>Reviewer: {reviewerLabel(c.reviewer)}</span>
                ) : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
