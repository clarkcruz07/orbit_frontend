import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { currentMonthKey, parseMonthKey } from '@/lib/dates'
import { EmptyState } from '@/ui/EmptyState'
import { timesheetApi, type TimesheetConfig } from './api'
import { useLoad, useMediaQuery } from './hooks'
import {
  addDaysIso,
  attendanceStateLabel,
  attendanceStateTone,
  formatClockTime,
  formatDayLong,
  formatHours,
  isIsoDate,
  mondayOf,
  sheetStatusLabel,
  sheetStatusTone,
  timesheetLink,
} from './logic'
import { MonthNav, MonthView } from './MonthView'
import { ErrorBlock, LoadingCard, Pill } from './parts'
import { WeekNav } from './TimesheetTab'

function HoursView({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 640px)')
  const rawWeek = params.get('week')
  const week = isIsoDate(rawWeek) ? mondayOf(rawWeek) : config.current_week_start
  const q = useLoad(() => timesheetApi.teamWeek(week), [week], 'The team hours could not be loaded.')
  const goWeek = (m: string) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'team')
    if (m === config.current_week_start) p.delete('week')
    else p.set('week', m)
    setParams(p, { replace: true })
  }
  return (
    <section className="card card-pad" aria-labelledby="team-hours-title" data-testid="team-hours">
      <div className="ts-section-head">
        <div>
          <h2 id="team-hours-title">Hours per person</h2>
          <p className="card-sub">Your direct reports, one row each. Read-only: open a timesheet to see the codes.</p>
        </div>
        <WeekNav week={week} currentWeek={config.current_week_start} onWeek={goWeek} />
      </div>
      {q.error && !q.data ? (
        <ErrorBlock problem={q.error} onRetry={q.reload} what="The team" />
      ) : !q.data ? (
        <LoadingCard testId="team-loading" lines={4} />
      ) : q.data.items.length === 0 ? (
        <EmptyState plain icon={<Users size={28} />} title="No direct reports" body="People who report to you will appear here with their hours for the week." />
      ) : phone ? (
        <ul className="ts-day-cards" data-testid="team-cards">
          {q.data.items.map((r) => (
            <li key={r.employee_id} className="ts-day-card" data-testid="team-card" data-status={r.status}>
              <div className="ts-day-card-top">
                <strong>{r.name}</strong>
                <Pill tone={sheetStatusTone(r.status)}>{sheetStatusLabel(r.status)}</Pill>
              </div>
              <div className="ts-day-card-row">
                <span className="ts-muted">{r.job_title ?? ''}</span>
                <span className="ts-day-card-hours">{formatHours(r.total_hours)} h</span>
              </div>
              <Link to={timesheetLink(q.data!.week_start, r.employee_id, 'team')} className="btn btn-secondary" data-testid="team-open-sheet">
                Open timesheet
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card ts-table-card">
          <table className="ts-table" data-testid="team-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
                <th scope="col" className="ts-num">
                  Hours
                </th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.employee_id} data-testid="team-row" data-status={r.status} data-employee={r.employee_id}>
                  <th scope="row" className="ts-day-cell">
                    {r.name}
                    {r.job_title ? <div className="ts-sub">{r.job_title}</div> : null}
                  </th>
                  <td>
                    <Pill tone={sheetStatusTone(r.status)}>{sheetStatusLabel(r.status)}</Pill>
                    {!r.persisted ? <span className="ts-muted"> not started</span> : null}
                  </td>
                  <td className="ts-num" data-testid="team-hours-cell">
                    {formatHours(r.total_hours)}
                  </td>
                  <td className="ts-actions-cell">
                    <Link to={timesheetLink(q.data!.week_start, r.employee_id, 'team')} className="ts-link" data-testid="team-open-sheet">
                      Open timesheet
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.items.length > 0 ? (
        <p className="ts-fine" data-testid="team-total">
          Team total this week: <strong>{formatHours(q.data.total_hours)}</strong> hours.
        </p>
      ) : null}
    </section>
  )
}

function PersonMonth({ employeeId, config }: { employeeId: string; config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const current = currentMonthKey(new Date(`${config.today}T12:00:00`))
  const raw = params.get('month')
  const month = parseMonthKey(raw) && raw && raw <= current ? raw : current
  const q = useLoad(() => timesheetApi.employeeMonth(employeeId, month), [employeeId, month], 'This attendance could not be loaded.')
  const update = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'team')
    mutate(p)
    setParams(p, { replace: true })
  }
  return (
    <section className="card card-pad" aria-labelledby="person-month-title" data-testid="person-month">
      <div className="ts-section-head">
        <div>
          <h2 id="person-month-title">Attendance of {q.data?.employee.name ?? 'this person'}</h2>
          <p className="card-sub">Read-only. Viewing someone else's attendance is recorded in the audit log.</p>
        </div>
        <div className="ts-head-actions">
          <MonthNav
            month={month}
            currentMonth={current}
            onMonth={(m) =>
              update((p) => {
                if (m === current) p.delete('month')
                else p.set('month', m)
              })
            }
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              update((p) => {
                p.delete('person')
                p.delete('month')
              })
            }
            data-testid="person-back"
          >
            <ChevronLeft size={16} aria-hidden="true" /> Back to the team
          </button>
        </div>
      </div>
      {q.error && !q.data ? <ErrorBlock problem={q.error} onRetry={q.reload} what="This attendance" /> : !q.data ? <LoadingCard testId="person-loading" lines={4} /> : <MonthView data={q.data} canRequest={false} />}
    </section>
  )
}

function AttendanceView({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 640px)')
  const raw = params.get('date')
  const date = isIsoDate(raw) && raw <= config.today ? raw : config.today
  const q = useLoad(() => timesheetApi.teamDay(date), [date], 'The team attendance could not be loaded.')
  const update = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'team')
    mutate(p)
    setParams(p, { replace: true })
  }
  const goDate = (d: string) => update((p) => (d === config.today ? p.delete('date') : p.set('date', d)))
  const tz = q.data?.timezone ?? config.timezone
  const personLink = (id: string) => {
    const p = new URLSearchParams({ tab: 'team', view: 'attendance', person: id })
    return `?${p.toString()}`
  }
  return (
    <section className="card card-pad" aria-labelledby="team-att-title" data-testid="team-attendance">
      <div className="ts-section-head">
        <div>
          <h2 id="team-att-title">Attendance of my team</h2>
          <p className="card-sub">One day at a time. Read-only: the punches are the employee's own.</p>
        </div>
        <div className="ts-nav" role="group" aria-label="Day">
          <button type="button" className="btn btn-secondary ts-nav-btn" onClick={() => goDate(addDaysIso(date, -1))} aria-label="Previous day" data-testid="day-prev">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong className="ts-nav-label" data-testid="day-label">
            {formatDayLong(date)}
          </strong>
          <button type="button" className="btn btn-secondary ts-nav-btn" disabled={date >= config.today} onClick={() => goDate(addDaysIso(date, 1))} aria-label="Next day" data-testid="day-next">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          {date !== config.today ? (
            <button type="button" className="btn btn-secondary" onClick={() => goDate(config.today)} data-testid="day-today">
              Today
            </button>
          ) : null}
        </div>
      </div>
      {q.error && !q.data ? (
        <ErrorBlock problem={q.error} onRetry={q.reload} what="The team attendance" />
      ) : !q.data ? (
        <LoadingCard testId="team-att-loading" lines={4} />
      ) : q.data.items.length === 0 ? (
        <EmptyState plain icon={<Users size={28} />} title="No direct reports" body="People who report to you will appear here." />
      ) : phone ? (
        <ul className="ts-day-cards" data-testid="team-att-cards">
          {q.data.items.map((r) => (
            <li key={r.employee_id} className="ts-day-card" data-testid="team-att-card" data-state={r.state}>
              <div className="ts-day-card-top">
                <strong>{r.name}</strong>
                <Pill tone={attendanceStateTone(r.state)}>{attendanceStateLabel(r.state)}</Pill>
              </div>
              <div className="ts-day-card-row">
                <span>
                  {formatClockTime(r.first_in, tz)} - {formatClockTime(r.last_out, tz)}
                </span>
                <span className="ts-day-card-hours">{formatHours(r.hours)} h</span>
              </div>
              <Link to={personLink(r.employee_id)} className="btn btn-secondary" data-testid="team-att-month">
                View month
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card ts-table-card">
          <table className="ts-table" data-testid="team-att-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">State</th>
                <th scope="col">In - Out</th>
                <th scope="col" className="ts-num">
                  Hours
                </th>
                <th scope="col">
                  <span className="sr-only">Month</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.employee_id} data-testid="team-att-row" data-state={r.state} data-employee={r.employee_id}>
                  <th scope="row" className="ts-day-cell">
                    {r.name}
                    {r.job_title ? <div className="ts-sub">{r.job_title}</div> : null}
                  </th>
                  <td>
                    <Pill tone={attendanceStateTone(r.state)}>{attendanceStateLabel(r.state)}</Pill>
                  </td>
                  <td>
                    {formatClockTime(r.first_in, tz)} - {formatClockTime(r.last_out, tz)}
                  </td>
                  <td className="ts-num">{formatHours(r.hours)}</td>
                  <td className="ts-actions-cell">
                    <Link to={personLink(r.employee_id)} className="ts-link" data-testid="team-att-month">
                      View month
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function TeamTab({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'attendance' ? 'attendance' : 'hours'
  const person = (params.get('person') ?? '').trim()
  const validPerson = /^[A-Za-z0-9_-]{1,40}$/.test(person) ? person : null
  const choose = (v: 'hours' | 'attendance') => {
    const p = new URLSearchParams()
    p.set('tab', 'team')
    if (v === 'attendance') p.set('view', 'attendance')
    setParams(p, { replace: true })
  }
  return (
    <div className="ts-stack" data-testid="tab-team">
      <div className="ts-tabs ts-tabs-small" role="tablist" aria-label="Team views">
        <button type="button" role="tab" aria-selected={view === 'hours'} className={`ts-tab${view === 'hours' ? ' active' : ''}`} onClick={() => choose('hours')} data-testid="team-view-hours">
          Timesheet hours
        </button>
        <button type="button" role="tab" aria-selected={view === 'attendance'} className={`ts-tab${view === 'attendance' ? ' active' : ''}`} onClick={() => choose('attendance')} data-testid="team-view-attendance">
          Attendance
        </button>
      </div>
      {view === 'hours' ? <HoursView config={config} /> : validPerson ? <PersonMonth employeeId={validPerson} config={config} /> : <AttendanceView config={config} />}
    </div>
  )
}
