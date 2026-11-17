import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Cake, CalendarDays, ChevronLeft, ChevronRight, PartyPopper } from 'lucide-react'
import { calendarApi, type CalendarEvent, type CalendarMonth } from '@/api/calendar'
import { CALENDAR_SPAN_MONTHS, agendaDays, buildMonthGrid, canShiftMonth, chipKind, chipText, clampMonth, groupByDate, weekdayLabels } from '@/lib/calendar'
import { currentMonthKey, formatWeekdayDayMonth, monthLabel, shiftMonth, todayIso } from '@/lib/dates'
import { EmptyState } from '@/ui/EmptyState'
import { Alert, Skeleton } from '@/ui/Feedback'
import { PageTitle } from '../PageTitle'
import '../pages.css'
import '../reimbursements/reimbursements.css'
import './calendar.css'

type Load = { kind: 'loading' } | { kind: 'ready'; data: CalendarMonth } | { kind: 'error'; message: string }

function Chip({ event }: { event: CalendarEvent }) {
  const kind = chipKind(event)
  const Icon = event.type === 'holiday' ? PartyPopper : Cake
  const tip = [event.title, event.subtitle].filter(Boolean).join(' - ')
  return (
    <li className={`cal-chip cal-chip-${kind}`} title={tip} data-testid="cal-chip" data-kind={kind} data-own={event.own ? 'true' : 'false'}>
      <Icon size={13} aria-hidden="true" />
      <span className="cal-chip-text">
        {kind === 'birthday' ? (
          <>
            {event.title}
            <span className="cal-chip-suffix"> - birthday</span>
          </>
        ) : (
          chipText(event)
        )}
      </span>
    </li>
  )
}

/** Company Calendar: month grid (tablet/desktop) or agenda (phone). Company holidays; birthdays as the server allows. */
export function CompanyCalendar() {
  const [params, setParams] = useSearchParams()
  const now = useMemo(() => new Date(), [])
  const current = currentMonthKey(now)
  const today = todayIso(now)
  const month = clampMonth(params.get('month'), current)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    calendarApi
      .month(month)
      .then((data) => live && setLoad({ kind: 'ready', data }))
      .catch((e: { response?: { status?: number } }) => {
        if (!live) return
        const status = e?.response?.status
        setLoad({ kind: 'error', message: status === 400 ? 'That month is not available.' : status ? 'The calendar could not be loaded.' : "Can't reach the Bluedge People service." })
      })
    return () => {
      live = false
    }
  }, [month])

  useEffect(() => run(), [run])

  function go(key: string) {
    setParams(key === current ? new URLSearchParams() : new URLSearchParams({ month: key }))
  }

  const canPrev = canShiftMonth(month, -1, current)
  const canNext = canShiftMonth(month, 1, current)
  const range = `The calendar covers ${CALENDAR_SPAN_MONTHS} months back and ahead.`
  const events = load.kind === 'ready' ? load.data.events : []
  const byDate = useMemo(() => groupByDate(events), [events])
  const grid = useMemo(() => buildMonthGrid(month), [month])
  const agenda = useMemo(() => agendaDays(events, month), [events, month])

  return (
    <div className="page cal-page" data-testid="calendar">
      <PageTitle title="Company Calendar" subtitle="Company holidays and birthdays." />

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="btn btn-secondary cal-nav-btn" aria-label="Previous month" disabled={!canPrev} title={canPrev ? undefined : range} onClick={() => go(shiftMonth(month, -1))} data-testid="cal-prev">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-secondary" disabled={month === current} onClick={() => go(current)} data-testid="cal-today">
            Today
          </button>
          <button type="button" className="btn btn-secondary cal-nav-btn" aria-label="Next month" disabled={!canNext} title={canNext ? undefined : range} onClick={() => go(shiftMonth(month, 1))} data-testid="cal-next">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <h2 className="cal-month" aria-live="polite" data-testid="cal-month" data-month={month}>
          {monthLabel(month)}
        </h2>
        <ul className="cal-legend" aria-label="Legend">
          <li>
            <span className="cal-swatch cal-swatch-holiday" aria-hidden="true" /> Holiday
          </li>
          <li>
            <span className="cal-swatch cal-swatch-birthday" aria-hidden="true" /> Birthday
          </li>
          <li>
            <span className="cal-swatch cal-swatch-own" aria-hidden="true" /> Your birthday
          </li>
        </ul>
      </div>

      {load.kind === 'error' ? (
        <div data-testid="cal-error">
          <Alert tone="danger">{load.message}</Alert>
          <button type="button" className="btn btn-secondary r-retry" onClick={() => run()}>
            Try again
          </button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="cal-loading">
          <span className="r-visually-hidden" role="status">
            Loading the calendar
          </span>
          <Skeleton style={{ height: 18, width: '30%', marginBottom: 14 }} />
          <Skeleton style={{ height: 220 }} />
        </div>
      ) : (
        <>
          <div className="card cal-grid-card" data-testid="calendar-grid">
            <table className="cal-grid">
              <caption className="r-visually-hidden">{monthLabel(month)}</caption>
              <thead>
                <tr>
                  {weekdayLabels().map((d) => (
                    <th key={d} scope="col">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((week) => (
                  <tr key={week[0].date}>
                    {week.map((cell) => {
                      const list = cell.inMonth ? byDate.get(cell.date) ?? [] : []
                      return (
                        <td
                          key={cell.date}
                          className={`cal-cell${cell.inMonth ? '' : ' outside'}${cell.date === today ? ' today' : ''}`}
                          data-date={cell.date}
                          data-testid="cal-cell"
                          aria-current={cell.date === today ? 'date' : undefined}
                        >
                          <span className="cal-day">{cell.day}</span>
                          {list.length > 0 ? (
                            <ul className="cal-chips">
                              {list.map((ev, i) => (
                                <Chip key={`${ev.type}-${ev.title}-${i}`} event={ev} />
                              ))}
                            </ul>
                          ) : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cal-agenda" data-testid="calendar-agenda">
            {agenda.length === 0 ? (
              <EmptyState plain icon={<CalendarDays size={24} />} title="Nothing this month" body={`No holidays or birthdays in ${monthLabel(month)}.`} />
            ) : (
              <ol className="cal-agenda-list">
                {agenda.map((day) => (
                  <li key={day.date} className={`cal-agenda-day${day.date === today ? ' today' : ''}`} data-date={day.date} data-testid="cal-agenda-day">
                    <h3>{formatWeekdayDayMonth(day.date)}</h3>
                    <ul className="cal-agenda-events">
                      {day.events.map((ev, i) => (
                        <li key={`${ev.type}-${ev.title}-${i}`} className={`cal-agenda-event cal-chip-${chipKind(ev)}`} data-testid="cal-agenda-event" data-kind={chipKind(ev)}>
                          <span className="cal-agenda-title">{ev.type === 'birthday' && ev.own ? 'Your birthday' : ev.title}</span>
                          <span className="cal-agenda-sub">{ev.type === 'birthday' ? (ev.own ? ev.subtitle ?? 'Birthday' : `Birthday${ev.subtitle ? ` - ${ev.subtitle}` : ''}`) : ev.subtitle ?? 'Holiday'}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  )
}
