import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { PaydayBadge } from '@/ui/Payday'
import { normalisePayday } from '@/lib/payday'
import { timesheetApi, type ReviewItem, type ReviewKind } from './api'
import { useLoad, useMediaQuery } from './hooks'
import { correctionLink, formatDateTimeIn, formatDayLabel, formatHours, formatHoursMinutes, formatWeekRange, timesheetLink } from './logic'
import { ErrorBlock, LoadingCard, Pager, Pill } from './parts'

const KINDS: { id: ReviewKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sheets', label: 'Timesheets' },
  { id: 'corrections', label: 'Corrections' },
]

function person(i: ReviewItem): string {
  return i.type === 'timesheet' ? (i.sheet?.employee.name ?? 'Unknown') : (i.correction?.employee.name ?? 'Unknown')
}
function subject(i: ReviewItem): string {
  if (i.type === 'timesheet' && i.sheet) return `Week of ${formatWeekRange(i.sheet.week_start)}`
  if (i.correction) {
    const c = i.correction
    return `${formatDayLabel(c.day)}, ${c.local_clock_in} - ${c.local_clock_out}${c.clock_out_next_day ? ' (next day)' : ''}`
  }
  return '-'
}
function amount(i: ReviewItem): string {
  if (i.type === 'timesheet' && i.sheet) return `${formatHours(i.sheet.total_hours)} h`
  return i.correction ? formatHoursMinutes(i.correction.hours) : '-'
}
function target(i: ReviewItem): string {
  if (i.type === 'timesheet' && i.sheet) return timesheetLink(i.sheet.week_start, i.sheet.employee.employee_id, 'approvals')
  return correctionLink(i.id)
}

export function ApprovalsTab({ timezone }: { timezone: string }) {
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 640px)')
  const kind = (KINDS.find((k) => k.id === params.get('kind'))?.id ?? 'all') as ReviewKind
  const page = Math.max(1, Number(params.get('page')) || 1)
  const q = useLoad(() => timesheetApi.review(kind, page), [kind, page], 'The review queue could not be loaded.')
  const update = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'approvals')
    mutate(p)
    setParams(p, { replace: true })
  }
  const counts = q.data?.counts
  const countOf = (k: ReviewKind) => (counts ? (k === 'all' ? counts.sheets + counts.corrections : k === 'sheets' ? counts.sheets : counts.corrections) : null)

  return (
    <div className="ts-stack" data-testid="tab-approvals">
      <section className="card card-pad" aria-labelledby="approvals-title">
        <div className="ts-section-head">
          <div>
            <h2 id="approvals-title">Waiting for my decision</h2>
            <p className="card-sub">Timesheets and attendance corrections that need you, oldest first. Open one to read it and decide.</p>
          </div>
          <div className="ts-tabs ts-tabs-small" role="tablist" aria-label="Kind">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                className={`ts-tab${kind === k.id ? ' active' : ''}`}
                onClick={() =>
                  update((p) => {
                    if (k.id === 'all') p.delete('kind')
                    else p.set('kind', k.id)
                    p.delete('page')
                  })
                }
                data-testid={`kind-${k.id}`}
              >
                {k.label}
                {countOf(k.id) !== null ? <span className="ts-tab-count"> {countOf(k.id)}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {q.error && !q.data ? (
          <ErrorBlock problem={q.error} onRetry={q.reload} what="The review queue" />
        ) : !q.data ? (
          <LoadingCard testId="queue-loading" lines={4} />
        ) : q.data.items.length === 0 ? (
          <EmptyState plain icon={<ClipboardCheck size={28} />} title="Nothing is waiting for your decision" body="Submitted timesheets and correction requests from the people you approve for will appear here." />
        ) : phone ? (
          <ul className="ts-day-cards" data-testid="queue-cards">
            {q.data.items.map((i) => (
              <li key={`${i.type}-${i.id}`} className="ts-day-card" data-testid="queue-card" data-type={i.type}>
                <div className="ts-day-card-top">
                  <strong>{person(i)}</strong>
                  <Pill tone={i.type === 'timesheet' ? 'blue' : 'amber'}>{i.type === 'timesheet' ? 'Timesheet' : 'Correction'}</Pill>
                </div>
                <div className="ts-day-card-row">
                  <span>{subject(i)}</span>
                  <span className="ts-day-card-hours">{amount(i)}</span>
                </div>
                {i.correction ? <PaydayBadge payday={normalisePayday(i.correction.payday)} testId="queue-payday" /> : null}
                <span className="ts-muted">Submitted {formatDateTimeIn(i.submitted_at, timezone)}</span>
                <Link to={target(i)} className="btn btn-primary" data-testid="queue-open">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card ts-table-card">
            <table className="ts-table" data-testid="queue-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Type</th>
                  <th scope="col">What</th>
                  <th scope="col" className="ts-num">
                    Hours
                  </th>
                  <th scope="col">Submitted</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((i) => (
                  <tr key={`${i.type}-${i.id}`} data-testid="queue-row" data-type={i.type} data-id={i.id}>
                    <th scope="row" className="ts-day-cell">
                      {person(i)}
                    </th>
                    <td>
                      <Pill tone={i.type === 'timesheet' ? 'blue' : 'amber'}>{i.type === 'timesheet' ? 'Timesheet' : 'Correction'}</Pill>
                    </td>
                    <td>
                      {subject(i)}
                      {i.correction ? <PaydayBadge payday={normalisePayday(i.correction.payday)} testId="queue-payday" /> : null}
                    </td>
                    <td className="ts-num">{amount(i)}</td>
                    <td className="ts-muted">{formatDateTimeIn(i.submitted_at, timezone)}</td>
                    <td className="ts-actions-cell">
                      <Link to={target(i)} className="ts-link" data-testid="queue-open">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data ? <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(n) => update((p) => (n <= 1 ? p.delete('page') : p.set('page', String(n))))} /> : null}
      </section>
    </div>
  )
}
