import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { todayIso } from '@/lib/dates'
import { leaveApi, type LeaveConfig, type LeaveRequest, type LeaveType } from './api'
import { formatDays, formatRange, formatDateTime, pageCount, rangeText, statusHint, statusLabel, statusTone, type Tone } from './logic'
import './leave.css'

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`lv-pill lv-pill-${statusTone(status)}`} title={statusHint(status)} data-testid="status-pill" data-status={status}>
      {statusLabel(status)}
    </span>
  )
}

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: Tone; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`lv-pill lv-pill-${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="lv-spinner-row" role="status">
      <span className="boot-spinner lv-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

/** Loads `GET /leave/config` once per mount. When it fails the page still works: "today" falls back to the browser's date. */
export function useLeaveConfig(): { config: LeaveConfig | null; today: string; year: number } {
  const [config, setConfig] = useState<LeaveConfig | null>(null)
  const fallback = useMemo(() => todayIso(new Date()), [])
  useEffect(() => {
    let live = true
    leaveApi
      .config()
      .then((c) => live && setConfig(c))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  const today = config?.today ?? fallback
  return { config, today, year: config?.year ?? Number(today.slice(0, 4)) }
}

/** Active leave types for the request form; `null` while loading. */
export function useLeaveTypes(): { types: LeaveType[] | null; error: boolean; reload: () => void } {
  const [types, setTypes] = useState<LeaveType[] | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    leaveApi
      .types()
      .then((r) => live && setTypes(r.items))
      .catch(() => live && setError(true))
    return () => {
      live = false
    }
  }, [tick])
  return { types, error, reload: () => setTick((t) => t + 1) }
}

export function Pager({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = pageCount(total, pageSize)
  if (total <= pageSize && page === 1) return <p className="lv-range" data-testid="leave-range">{rangeText(total, page, pageSize)}</p>
  return (
    <nav className="lv-pager" aria-label="Pagination" data-testid="leave-pager">
      <span className="lv-range" data-testid="leave-range">
        {rangeText(total, page, pageSize)}
      </span>
      <div className="lv-pager-buttons">
        <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="leave-prev">
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        <span className="lv-page-of" aria-live="polite">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="leave-next">
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

/** Table (>= 860px) and cards (below) over the same rows. `showEmployee` adds the person for approver/oversight lists. */
export function RequestList({ items, showEmployee }: { items: LeaveRequest[]; showEmployee: boolean }) {
  return (
    <>
      <div className="card lv-table-card" data-testid="leave-table">
        <table className="lv-table">
          <thead>
            <tr>
              {showEmployee ? <th scope="col">Employee</th> : null}
              <th scope="col">Dates</th>
              <th scope="col">Type</th>
              <th scope="col" className="lv-num">
                Days
              </th>
              <th scope="col">Status</th>
              <th scope="col">Approver</th>
              <th scope="col">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.request_id} data-testid="leave-row" data-status={r.status} data-id={r.request_id}>
                {showEmployee ? (
                  <td>
                    <strong className="lv-wrap">{r.employee?.name ?? 'Unknown'}</strong>
                    {r.employee?.department ? <div className="lv-sub">{r.employee.department}</div> : null}
                  </td>
                ) : null}
                <td>
                  <Link to={`/leave/${r.request_id}`} className="lv-row-link" data-testid="leave-open">
                    {formatRange(r.start_date, r.end_date, r.half_day)}
                  </Link>
                </td>
                <td className="lv-wrap">{r.type_name}</td>
                <td className="lv-num">{formatDays(r.days)}</td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className="lv-muted lv-wrap">{r.approver ? (r.approver.kind === 'hr_fallback' ? 'HR' : r.approver.name ?? '-') : '-'}</td>
                <td className="lv-muted">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="lv-cards" data-testid="leave-cards">
        {items.map((r) => (
          <li key={r.request_id}>
            <Link to={`/leave/${r.request_id}`} className="lv-card-item card" data-testid="leave-card" data-status={r.status}>
              <div className="lv-card-top">
                <strong>{formatRange(r.start_date, r.end_date, r.half_day)}</strong>
                <StatusPill status={r.status} />
              </div>
              {showEmployee ? <div className="lv-sub">{r.employee?.name ?? 'Unknown'}{r.employee?.department ? ` - ${r.employee.department}` : ''}</div> : null}
              <div className="lv-card-meta">
                <span>{r.type_name}</span>
                <span className="lv-card-days">{formatDays(r.days)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
