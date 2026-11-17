import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { performanceApi, type OverviewPeriod } from './api'
import { useDebounced, useLoad } from './hooks'
import { ErrorBlock, LoadingCard, ProgressBar } from './parts'
import { GOAL_STATUSES, goalStatusLabel } from './logic'

/**
 * HR overview: counts only. The API returns no names, free text or mood, and this page never shows any.
 * Whether HR may see mood on individual check-ins is a Settings switch; it is reported from the server's config.
 */
export function HrOverview({ hrCanSeeMood }: { hrCanSeeMood: boolean }) {
  const [periodText, setPeriodText] = useState('')
  const period = useDebounced(periodText, 300)
  const [department, setDepartment] = useState('')
  const [departments, setDepartments] = useState<string[]>([])
  const state = useLoad(
    () =>
      performanceApi.overview({ period, department }).then((r) => {
        // Keep the full list of departments once seen so the filter does not collapse after filtering.
        setDepartments((prev) => (r.data.departments.length >= prev.length ? r.data.departments : prev))
        return r.data
      }),
    [period, department],
    'The overview could not be loaded.',
  )
  const d = state.data

  return (
    <section aria-labelledby="overview-title" data-testid="hr-overview">
      <div className="pf-toolbar">
        <h2 id="overview-title" className="pf-section-title">
          HR overview
        </h2>
      </div>
      <p className="pf-help" data-testid="overview-note">
        Counts only: no names, written content or mood appear here. Mood on individual check-ins is {hrCanSeeMood ? 'currently visible to HR (a Settings switch)' : 'hidden from HR unless a Settings switch allows it (it is currently off)'}.
      </p>

      <div className="pf-filters" data-testid="overview-filters">
        <label className="pf-filter-field">
          <span className="pf-label">Period (exact name)</span>
          <input className="pf-input" value={periodText} onChange={(e) => setPeriodText(e.target.value)} placeholder="e.g. 2027-Q1" data-testid="overview-period" autoComplete="off" />
        </label>
        <label className="pf-filter-field">
          <span className="pf-label">Department</span>
          <select className="pf-input pf-select" value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="overview-department">
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
        <ErrorBlock message={state.error.status === 403 ? 'The HR overview is only available to HR administrators.' : state.error.detail} onRetry={state.reload} />
      ) : !d ? (
        <LoadingCard />
      ) : (
        <>
          <div className="card card-pad" data-testid="overview-goals">
            <h3 className="pf-card-title">Goals ({d.goals.total})</h3>
            <ul className="pf-stat-row">
              {GOAL_STATUSES.map((s) => (
                <li key={s} className="pf-stat" data-testid={`goals-${s}`}>
                  <span className="pf-stat-num">{d.goals.by_status?.[s] ?? 0}</span>
                  <span className="pf-stat-label">{goalStatusLabel(s)}</span>
                </li>
              ))}
            </ul>
          </div>

          {d.periods.length === 0 ? (
            <EmptyState icon={<BarChart3 size={28} />} title="No check-ins yet" body="Completion counts per period appear here once check-ins exist." />
          ) : (
            <ul className="pf-rows" data-testid="overview-periods">
              {d.periods.map((p) => (
                <li key={p.period_label}>
                  <PeriodCard p={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function PeriodCard({ p }: { p: OverviewPeriod }) {
  return (
    <article className="card card-pad pf-period" data-testid="overview-period-card" data-period={p.period_label}>
      <div className="pf-card-head">
        <h3 className="pf-card-title">{p.period_label}</h3>
        <span className="pf-pct" data-testid="period-pct">
          {p.completion_pct}% complete
        </span>
      </div>
      <ProgressBar value={p.completion_pct} label={`Completion for ${p.period_label}`} />
      <ul className="pf-stat-row">
        <li className="pf-stat">
          <span className="pf-stat-num" data-testid="period-requested">{p.requested}</span>
          <span className="pf-stat-label">Requested</span>
        </li>
        <li className="pf-stat">
          <span className="pf-stat-num" data-testid="period-submitted">{p.submitted}</span>
          <span className="pf-stat-label">Submitted</span>
        </li>
        <li className="pf-stat">
          <span className="pf-stat-num" data-testid="period-acknowledged">{p.acknowledged}</span>
          <span className="pf-stat-label">Acknowledged</span>
        </li>
        <li className="pf-stat">
          <span className="pf-stat-num" data-testid="period-total">{p.total}</span>
          <span className="pf-stat-label">Total</span>
        </li>
      </ul>
      {p.by_department.length > 0 ? (
        <div className="pf-dept" data-testid="period-departments">
          <h4 className="pf-subhead">By department</h4>
          <ul className="pf-dept-list">
            {p.by_department.map((x) => (
              <li key={x.department} className="pf-dept-row">
                <span className="pf-dept-name">{x.department}</span>
                <span className="pf-dept-nums">
                  {x.completed} of {x.total} complete ({x.completion_pct}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}
