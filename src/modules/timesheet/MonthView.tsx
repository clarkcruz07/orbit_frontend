import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthLabel, monthNumber, shiftMonth } from '@/lib/dates'
import type { DayRecord, MonthAttendance } from './api'
import { useMediaQuery } from './hooks'
import { dayFlags, formatClockTime, formatDayLabel, formatHours, formatHoursMinutes } from './logic'
import { Pill } from './parts'

/** Month navigation limits mirror the server: no future month, at most 24 months back. */
export function monthNavLimits(month: string, currentMonth: string): { canPrev: boolean; canNext: boolean } {
  const m = monthNumber(month)
  const c = monthNumber(currentMonth)
  if (m === null || c === null) return { canPrev: false, canNext: false }
  return { canPrev: c - m < 24, canNext: m < c }
}

export function MonthNav({ month, currentMonth, onMonth }: { month: string; currentMonth: string; onMonth: (m: string) => void }) {
  const { canPrev, canNext } = monthNavLimits(month, currentMonth)
  return (
    <div className="ts-nav" role="group" aria-label="Month">
      <button type="button" className="btn btn-secondary ts-nav-btn" disabled={!canPrev} onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" data-testid="month-prev">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <strong className="ts-nav-label" data-testid="month-label">
        {monthLabel(month)}
      </strong>
      <button type="button" className="btn btn-secondary ts-nav-btn" disabled={!canNext} onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" data-testid="month-next">
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {month !== currentMonth ? (
        <button type="button" className="btn btn-secondary" onClick={() => onMonth(currentMonth)} data-testid="month-current">
          This month
        </button>
      ) : null}
    </div>
  )
}

function Times({ d, tz }: { d: DayRecord; tz: string }) {
  const first = d.effective?.first_in ?? d.sessions[0]?.clock_in ?? null
  const last = d.effective?.last_out ?? null
  if (!first && !last) return <span className="ts-muted" data-testid="day-in">-</span>
  return (
    <>
      <span data-testid="day-in">{first ? formatClockTime(first, tz) : '-'}</span>
      <span aria-hidden="true"> - </span>
      <span data-testid="day-out">{last ? formatClockTime(last, tz) : d.open ? (d.needs_correction ? 'not closed' : 'running') : '-'}</span>
    </>
  )
}

function Original({ d, tz }: { d: DayRecord; tz: string }) {
  if (d.effective?.source !== 'correction') return null
  if (d.sessions.length === 0) return <div className="ts-sub">Original punches: none</div>
  return (
    <div className="ts-sub">
      Original punches: {d.sessions.map((s) => `${formatClockTime(s.clock_in, tz)}-${s.clock_out ? formatClockTime(s.clock_out, tz) : 'open'}`).join(', ')}
    </div>
  )
}

function Flags({ d }: { d: DayRecord }) {
  const flags = dayFlags(d)
  if (flags.length === 0) return <span className="ts-muted">-</span>
  return (
    <span className="ts-flags">
      {flags.map((f) => (
        <Pill key={f.key} tone={f.tone} testId={`flag-${f.key}`}>
          {f.label}
        </Pill>
      ))}
    </span>
  )
}

function hoursText(d: DayRecord): string {
  return d.effective ? formatHours(d.effective.hours) : '-'
}

function requestLink(d: DayRecord): string {
  const p = new URLSearchParams({ tab: 'corrections', new: '1', day: d.date })
  const flagged = d.sessions.find((s) => s.needs_correction)
  if (flagged) p.set('session_id', flagged.session_id)
  return `?${p.toString()}`
}

export function MonthView({ data, canRequest }: { data: MonthAttendance; canRequest: boolean }) {
  const phone = useMediaQuery('(max-width: 640px)')
  const tz = data.timezone
  const t = data.totals
  return (
    <div data-testid="month-view" data-month={data.month}>
      <p className="ts-totals" data-testid="month-totals">
        <span>
          <strong>{formatHours(t.hours)}</strong> hours
        </span>
        <span>
          <strong>{t.days_worked}</strong> {t.days_worked === 1 ? 'day' : 'days'} worked
        </span>
        <span className={t.needs_correction_days ? 'ts-totals-warn' : undefined}>
          <strong>{t.needs_correction_days}</strong> {t.needs_correction_days === 1 ? 'day needs' : 'days need'} correction
        </span>
        <span className="ts-muted">Times are shown in {tz}.</span>
      </p>
      {phone ? (
        <ul className="ts-day-cards" data-testid="month-cards">
          {data.days.map((d) => (
            <li key={d.date} className={`ts-day-card${d.is_today ? ' today' : ''}${d.needs_correction ? ' flagged' : ''}`} data-testid="day-card" data-date={d.date}>
              <div className="ts-day-card-top">
                <strong>{formatDayLabel(d.date)}</strong>
                {d.is_today ? <Pill tone="violet">Today</Pill> : null}
              </div>
              <div className="ts-day-card-row">
                <span>
                  <Times d={d} tz={tz} />
                </span>
                <span className="ts-day-card-hours">{d.effective ? formatHoursMinutes(d.effective.hours) : '-'}</span>
              </div>
              <Original d={d} tz={tz} />
              <Flags d={d} />
              {canRequest && d.can_request_correction ? (
                <Link to={requestLink(d)} className="btn btn-secondary" data-testid="request-correction-link">
                  Request correction
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="card ts-table-card">
          <table className="ts-table" data-testid="month-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">In - Out</th>
                <th scope="col" className="ts-num">
                  Hours
                </th>
                <th scope="col">Notes</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.date} className={`${d.is_today ? 'today' : ''}${d.needs_correction ? ' flagged' : ''}`} data-testid="day-row" data-date={d.date} data-today={d.is_today ? '1' : '0'}>
                  <th scope="row" className="ts-day-cell">
                    {formatDayLabel(d.date)}
                    {d.is_today ? <Pill tone="violet">Today</Pill> : null}
                  </th>
                  <td>
                    <Times d={d} tz={tz} />
                    <Original d={d} tz={tz} />
                  </td>
                  <td className="ts-num" data-testid="day-hours">
                    {hoursText(d)}
                  </td>
                  <td>
                    <Flags d={d} />
                  </td>
                  <td className="ts-actions-cell">
                    {canRequest && d.can_request_correction ? (
                      <Link to={requestLink(d)} className="ts-link" data-testid="request-correction-link">
                        Request correction
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
