import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Clock, LogIn, LogOut } from 'lucide-react'
import { currentMonthKey, parseMonthKey } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { timesheetApi, type AttendanceStatus, type DayRecord, type TimesheetConfig } from './api'
import { useLoad, useTicker } from './hooks'
import {
  elapsedMs,
  formatClockTime,
  formatDateTimeIn,
  formatDayLong,
  dayStamp,
  isOverLimit,
  toProblem,
  type Problem,
} from './logic'
import { MonthNav, MonthView } from './MonthView'
import { Banner, ErrorBlock, LoadingCard } from './parts'

/** Today's one time in and one time out. Clocking in or out again just updates them: no list, no running clock. */
function Stamps({ stamp, tz }: { stamp: ReturnType<typeof dayStamp>; tz: string }) {
  if (!stamp) return null
  return (
    <div className="ts-stamp-row" data-testid="clock-stamps" role="group" aria-label="Today's time in and time out">
      <span className="ts-stamp">
        <span className="ts-stamp-label">Time in</span>
        <strong data-testid="stamp-in">{formatClockTime(stamp.clockIn, tz)}</strong>
      </span>
      <span className="ts-stamp">
        <span className="ts-stamp-label">Time out</span>
        <strong data-testid="stamp-out" className={stamp.clockOut ? undefined : 'ts-stamp-pending'}>
          {stamp.clockOut ? formatClockTime(stamp.clockOut, tz) : 'Not yet'}
        </strong>
      </span>
    </div>
  )
}

export function ClockCard({ config, today, onChanged }: { config: TimesheetConfig; today: DayRecord | null; onChanged: () => void }) {
  const status = useLoad<AttendanceStatus>(() => timesheetApi.status(), [], 'Your attendance status could not be loaded.')
  const [busy, setBusy] = useState<'clock_in' | 'clock_out' | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const guard = useRef(false)

  const s = status.data
  const open = s?.open_session ?? null
  const tz = s?.timezone ?? config.timezone
  const nowMs = useTicker(Boolean(open))
  const ms = open && s ? elapsedMs(open.clock_in, s.now, status.at, nowMs) : 0
  // The server decides "flagged" (and which buttons exist). When the local timer passes the limit, ask the server once.
  const flagged = Boolean(s?.needs_correction)
  const localOver = Boolean(open && isOverLimit(ms))
  const allowed = s?.allowed_actions ?? []
  const stamp = dayStamp(today?.sessions ?? [], open)
  const reloadStatus = status.reload
  useEffect(() => {
    if (localOver && !flagged) reloadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localOver])

  const act = useCallback(
    async (which: 'clock_in' | 'clock_out') => {
      if (guard.current) return
      guard.current = true
      setBusy(which)
      setProblem(null)
      setDone(null)
      try {
        const session = which === 'clock_in' ? await timesheetApi.clockIn() : await timesheetApi.clockOut()
        setDone(
          which === 'clock_in'
            ? `Clocked in at ${formatClockTime(session.clock_in, tz)}.`
            : `Clocked out at ${formatClockTime(session.clock_out, tz)}.`,
        )
      } catch (e) {
        setProblem(toProblem(e, which === 'clock_in' ? 'Clocking in did not work.' : 'Clocking out did not work.'))
      } finally {
        guard.current = false
        setBusy(null)
        reloadStatus()
        onChanged()
      }
    },
    [tz, reloadStatus, onChanged],
  )

  if (status.loading && !s) return <LoadingCard testId="clock-loading" lines={2} />
  if (status.error && !s) return <ErrorBlock problem={status.error} onRetry={status.reload} what="Attendance" />
  if (!s) return null

  const correctionLink = (() => {
    const p = new URLSearchParams({ tab: 'corrections', new: '1' })
    if (open) {
      p.set('day', open.day)
      p.set('session_id', open.session_id)
    }
    return `?${p.toString()}`
  })()

  return (
    <section className={`card card-pad ts-clock${flagged ? ' flagged' : ''}`} aria-labelledby="clock-title" data-testid="clock-card" data-state={flagged ? 'flagged' : open ? 'in' : 'out'}>
      <div className="ts-clock-head">
        <span className="ts-clock-icon" aria-hidden="true">
          {flagged ? <AlertTriangle size={22} /> : <Clock size={22} />}
        </span>
        <div>
          <h2 id="clock-title">{flagged ? 'This session needs a correction' : open ? 'You are clocked in' : 'You are not clocked in'}</h2>
          <p className="card-sub" data-testid="clock-sub">
            {formatDayLong(s.today)} - company time ({tz})
          </p>
        </div>
      </div>

      {flagged ? (
        <div className="ts-flag-box" data-testid="flagged-explainer">
          <p>
            {open ? (
              <>
                You clocked in on <strong>{formatDateTimeIn(open.clock_in, tz)}</strong> and never clocked out.
              </>
            ) : (
              'A session was left open.'
            )}{' '}
            A session can last at most {s.max_session_hours} hours, so clocking in and out is paused until this is sorted out.
          </p>
          <ul>
            <li>Nothing was closed automatically and your original punch is kept as it is.</li>
            <li>Request a correction with the times you actually worked. Your manager (or HR if you have none) reviews it.</li>
            <li>Once the correction is approved you can clock in again.</li>
          </ul>
        </div>
      ) : open ? (
        <Stamps stamp={stamp} tz={tz} />
      ) : stamp ? (
        <Stamps stamp={stamp} tz={tz} />
      ) : (
        <p className="ts-clock-idle" data-testid="clock-idle">
          Nothing is stamped yet today. Clock in to record your time in.
        </p>
      )}

      <div className="ts-clock-actions">
        {allowed.includes('clock_in') ? (
          <button type="button" className="btn btn-primary btn-lg ts-big" onClick={() => act('clock_in')} disabled={busy !== null} data-testid="clock-in">
            <LogIn size={20} aria-hidden="true" /> {busy === 'clock_in' ? 'Clocking in...' : 'Clock in'}
          </button>
        ) : null}
        {allowed.includes('clock_out') ? (
          <button type="button" className="btn btn-primary btn-lg ts-big ts-big-out" onClick={() => act('clock_out')} disabled={busy !== null} data-testid="clock-out">
            <LogOut size={20} aria-hidden="true" /> {busy === 'clock_out' ? 'Clocking out...' : 'Clock out'}
          </button>
        ) : null}
        {allowed.includes('request_correction') ? (
          <Link to={correctionLink} className="btn btn-primary btn-lg ts-big" data-testid="flagged-request-correction">
            Request a correction
          </Link>
        ) : null}
      </div>

      {problem ? (
        <div className="ts-msg" data-testid="clock-error">
          <Alert tone="danger">{problem.detail}</Alert>
        </div>
      ) : null}
      {done && !problem ? (
        <p className="ts-ok" role="status" data-testid="clock-done">
          {done}
        </p>
      ) : null}
      {status.error && s ? (
        <div className="ts-msg">
          <Alert tone="warning">The latest status could not be loaded; what you see may be out of date.</Alert>
        </div>
      ) : null}
    </section>
  )
}

export function TodayTab({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const current = currentMonthKey(new Date(`${config.today}T12:00:00`))
  const rawMonth = params.get('month')
  const month = parseMonthKey(rawMonth) && rawMonth && rawMonth <= current ? rawMonth : current
  const data = useLoad(() => timesheetApi.myMonth(month), [month], 'Your attendance for this month could not be loaded.')

  const setMonth = (m: string) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'today')
    if (m === current) p.delete('month')
    else p.set('month', m)
    setParams(p, { replace: true })
  }
  const todayRecord = data.data?.days.find((d) => d.is_today) ?? null
  const reload = data.reload

  return (
    <div className="ts-stack" data-testid="tab-today">
      <ClockCard config={config} today={todayRecord} onChanged={reload} />
      <section className="card card-pad" aria-labelledby="month-title">
        <div className="ts-section-head">
          <div>
            <h2 id="month-title">My attendance</h2>
            <p className="card-sub">Your punches for the month. A correction never overwrites a punch: both are kept.</p>
          </div>
          <MonthNav month={month} currentMonth={current} onMonth={setMonth} />
        </div>
        {data.error && !data.data ? (
          <ErrorBlock problem={data.error} onRetry={data.reload} what="This month" />
        ) : !data.data ? (
          <LoadingCard testId="month-loading" lines={4} />
        ) : (
          <MonthView data={data.data} canRequest />
        )}
      </section>
      <Banner tone="info" testId="attendance-note">
        A day with a punch left open for more than {config.max_session_hours} hours is flagged for correction. Flagged days are never closed automatically.
      </Banner>
    </div>
  )
}
