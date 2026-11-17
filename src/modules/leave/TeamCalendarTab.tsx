import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { CALENDAR_SPAN_MONTHS, buildMonthGrid, canShiftMonth, clampMonth, weekdayLabels } from '@/lib/calendar'
import { formatWeekdayDayMonth, monthLabel, shiftMonth } from '@/lib/dates'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi, type TeamItem, type TeamMonth } from './api'
import { agendaEntries, chipLabel, formatDays, formatRange, leaveByDate, monthOfDate, typeTone } from './logic'

type Load = { kind: 'loading' } | { kind: 'ready'; data: TeamMonth } | { kind: 'error'; message: string }
const MAX_CHIPS = 3

function Chip({ item }: { item: TeamItem }) {
  const label = chipLabel(item)
  return (
    <li className={`lcal-chip lcal-type-${typeTone(item.type_id)}${item.own ? ' own' : ''}`} title={`${label} (${formatRange(item.start_date, item.end_date, item.half_day)})`} data-testid="lcal-chip" data-own={item.own ? 'true' : 'false'}>
      <span className="lcal-chip-text">{label}</span>
    </li>
  )
}

/** Team calendar: approved leave only (never reasons). Month grid at >= 641px, agenda list below. */
export function TeamCalendarTab({ today }: { today: string }) {
  const [params, setParams] = useSearchParams()
  const current = monthOfDate(today) ?? '2026-01'
  const month = clampMonth(params.get('month'), current)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    leaveApi
      .team(month)
      .then((data) => live && setLoad({ kind: 'ready', data }))
      .catch((e: { response?: { status?: number } }) => {
        if (!live) return
        const status = e?.response?.status
        setLoad({ kind: 'error', message: status === 400 ? 'That month is not available.' : status ? 'The team calendar could not be loaded.' : "Can't reach the Bluedge People service." })
      })
    return () => {
      live = false
    }
  }, [month])
  useEffect(() => run(), [run])
  useEffect(() => setSelected(null), [month])

  function go(key: string) {
    const p = new URLSearchParams(params)
    p.set('tab', 'calendar')
    if (key === current) p.delete('month')
    else p.set('month', key)
    setParams(p)
  }

  const items = load.kind === 'ready' ? load.data.items : []
  const byDate = useMemo(() => leaveByDate(items, month), [items, month])
  const grid = useMemo(() => buildMonthGrid(month), [month])
  const agenda = useMemo(() => agendaEntries(items, month), [items, month])
  const types = useMemo(() => [...new Map(items.map((i) => [i.type_id, i.type_name])).entries()], [items])
  const canPrev = canShiftMonth(month, -1, current)
  const canNext = canShiftMonth(month, 1, current)
  const range = `The calendar covers ${CALENDAR_SPAN_MONTHS} months back and ahead.`
  const dayList = selected ? byDate.get(selected) ?? [] : []

  return (
    <div data-testid="tab-panel-calendar" className="lcal">
      <p className="lv-scope-sub">Approved leave you are allowed to see. Reasons and comments are never shown here.</p>
      <div className="lcal-toolbar">
        <div className="lcal-nav">
          <button type="button" className="btn btn-secondary lcal-nav-btn" aria-label="Previous month" disabled={!canPrev} title={canPrev ? undefined : range} onClick={() => go(shiftMonth(month, -1))} data-testid="lcal-prev">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-secondary" disabled={month === current} onClick={() => go(current)} data-testid="lcal-today">
            Today
          </button>
          <button type="button" className="btn btn-secondary lcal-nav-btn" aria-label="Next month" disabled={!canNext} title={canNext ? undefined : range} onClick={() => go(shiftMonth(month, 1))} data-testid="lcal-next">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <h2 className="lcal-month" aria-live="polite" data-testid="lcal-month" data-month={month}>
          {monthLabel(month)}
        </h2>
        {types.length > 0 ? (
          <ul className="lcal-legend" aria-label="Leave types in this month">
            {types.map(([id, name]) => (
              <li key={id}>
                <span className={`lcal-swatch lcal-type-${typeTone(id)}`} aria-hidden="true" /> {name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {load.kind === 'error' ? (
        <div data-testid="lcal-error">
          <Alert tone="danger">{load.message}</Alert>
          <button type="button" className="btn btn-secondary lv-retry" onClick={() => run()}>
            Try again
          </button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="lcal-loading">
          <span className="sr-only" role="status">
            Loading the team calendar
          </span>
          <Skeleton style={{ height: 18, width: '30%', marginBottom: 14 }} />
          <Skeleton style={{ height: 220 }} />
        </div>
      ) : (
        <>
          <div className="card lcal-grid-card" data-testid="lcal-grid">
            <table className="lcal-grid">
              <caption className="sr-only">Approved leave in {monthLabel(month)}</caption>
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
                      const extra = list.length - MAX_CHIPS
                      return (
                        <td key={cell.date} className={`lcal-cell${cell.inMonth ? '' : ' outside'}${cell.date === today ? ' today' : ''}`} data-date={cell.date} data-testid="lcal-cell" aria-current={cell.date === today ? 'date' : undefined}>
                          <span className="lcal-day">{cell.day}</span>
                          {list.length > 0 ? (
                            <ul className="lcal-chips">
                              {list.slice(0, extra > 0 ? MAX_CHIPS - 1 : MAX_CHIPS).map((it, i) => (
                                <Chip key={`${it.employee_id}-${it.type_id}-${it.start_date}-${i}`} item={it} />
                              ))}
                              {extra > 0 ? (
                                <li>
                                  <button type="button" className="lcal-more" onClick={() => setSelected(cell.date)} data-testid="lcal-more" aria-label={`Show all ${list.length} people away on ${formatWeekdayDayMonth(cell.date)}`}>
                                    +{list.length - (MAX_CHIPS - 1)} more
                                  </button>
                                </li>
                              ) : null}
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

          {selected && dayList.length > 0 ? (
            <section className="card card-pad lcal-day-panel" aria-label={`Away on ${formatWeekdayDayMonth(selected)}`} data-testid="lcal-day-panel">
              <div className="lv-section-head">
                <h3>Away on {formatWeekdayDayMonth(selected)}</h3>
                <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)} data-testid="lcal-day-close">
                  <X size={16} aria-hidden="true" /> Close
                </button>
              </div>
              <ul className="lcal-day-list">
                {dayList.map((it, i) => (
                  <li key={`${it.employee_id}-${i}`} className={`lcal-chip lcal-type-${typeTone(it.type_id)}${it.own ? ' own' : ''}`}>
                    <span className="lcal-chip-wrap">{chipLabel(it)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="lcal-agenda" data-testid="lcal-agenda">
            {agenda.length === 0 ? (
              <EmptyState plain icon={<CalendarDays size={24} />} title="Nobody is away this month" body={`No approved leave that you can see in ${monthLabel(month)}.`} />
            ) : (
              <ol className="lcal-agenda-list">
                {agenda.map(({ item, from, to }, i) => (
                  <li key={`${item.employee_id}-${item.start_date}-${i}`} className={`lcal-agenda-item lcal-type-${typeTone(item.type_id)}${item.own ? ' own' : ''}`} data-testid="lcal-agenda-item">
                    <span className="lcal-agenda-name">{item.own ? `${item.employee_name} (you)` : item.employee_name}</span>
                    <span className="lcal-agenda-sub">
                      {item.type_name} - {formatRange(from, to, item.half_day)}
                      {from !== item.start_date || to !== item.end_date ? ` (this month; ${formatRange(item.start_date, item.end_date, item.half_day)} in all)` : ''}
                    </span>
                    <span className="lcal-agenda-sub">{item.department ? `${item.department} - ` : ''}{formatDays(item.days)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {agenda.length === 0 ? (
            <div className="lcal-empty-grid" data-testid="lcal-empty-grid">
              <p className="lv-muted">Nobody is away in {monthLabel(month)}.</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
