import { useEffect, useState, type FormEvent } from 'react'
import { Clock } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { settingsApi, DAY_LABELS, type WorkSchedule } from './api'
import { describeError } from './logic'
import { Panel, Switch } from './parts'

/**
 * "Work schedule and reminders" (HR only): the one company-wide schedule the Log in / Log out push reminders follow.
 * Loads from `GET /settings/work-schedule` and saves through `PUT`. The server refuses impossible values (422); its sentence is shown as is.
 */
export function WorkScheduleCard() {
  const [saved, setSaved] = useState<WorkSchedule | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [login, setLogin] = useState('09:00')
  const [logout, setLogout] = useState('18:00')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [lead, setLead] = useState('10')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  function apply(s: WorkSchedule) {
    setSaved(s)
    setEnabled(s.enabled)
    setLogin(s.login_time)
    setLogout(s.logout_time)
    setDays(s.days)
    setLead(String(s.lead_minutes))
  }

  useEffect(() => {
    let alive = true
    settingsApi
      .workSchedule()
      .then((s) => alive && apply(s))
      .catch((err) => alive && setLoadError(describeError(err, 'The work schedule could not be loaded.').message))
    return () => {
      alive = false
    }
  }, [])

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const next = await settingsApi.saveWorkSchedule({ enabled, login_time: login, logout_time: logout, days, lead_minutes: Number(lead) })
      apply(next)
      setStatus('Saved. Reminders follow this schedule from now on.')
    } catch (err) {
      const detail = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response
      const server = detail?.status === 422 && typeof detail.data?.detail === 'string' ? detail.data.detail : null
      setError(server ?? describeError(err, 'Your change was not saved.').message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      id="st-schedule-h"
      title="Work schedule and reminders"
      sub="One schedule for the whole company. It sets when the Log in and Log out reminders reach people's phones."
      testId="hr-schedule-panel"
    >
      {loadError ? (
        <div className="st-feedback-error" data-testid="schedule-load-error">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      ) : null}
      {!saved && !loadError ? <p className="st-foot">Loading...</p> : null}
      {saved ? (
        <form onSubmit={save} data-testid="schedule-form" noValidate>
          <div className="st-setting">
            <div className="st-row-text">
              <strong id="sched-label">Send Log in and Log out reminders</strong>
              <span id="sched-desc">People who installed the mobile app get a push notification. Nothing is sent on days off, public holidays or approved leave.</span>
            </div>
            <Switch checked={enabled} labelId="sched-label" describedBy="sched-desc" onChange={setEnabled} testId="schedule-enabled" />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="sched-login">
              Log in time
            </label>
            <input id="sched-login" type="time" value={login} onChange={(e) => setLogin(e.target.value)} data-testid="schedule-login" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sched-logout">
              Log out time
            </label>
            <input id="sched-logout" type="time" value={logout} onChange={(e) => setLogout(e.target.value)} data-testid="schedule-logout" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sched-lead">
              Send the Log in reminder this many minutes before (0 to 120)
            </label>
            <input id="sched-lead" type="number" min={0} max={120} step={1} value={lead} onChange={(e) => setLead(e.target.value)} data-testid="schedule-lead" />
          </div>

          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Working days</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {DAY_LABELS.map(([n, label]) => (
                <label key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={days.includes(n)} onChange={() => toggleDay(n)} data-testid={`schedule-day-${n}`} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="st-feedback" aria-live="polite" data-testid="schedule-status">
            {status ? <span className="st-ok">{status}</span> : null}
          </div>
          {error ? (
            <div className="st-feedback-error" data-testid="schedule-error">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="schedule-save">
            {busy ? 'Saving...' : 'Save schedule'}
          </button>
          <p className="st-foot" data-testid="schedule-note">
            <Clock size={14} aria-hidden="true" /> Times are in {saved.timezone}.{' '}
            {saved.is_default ? 'These are the placeholder defaults: nobody has saved a schedule yet.' : 'Last saved by HR.'}
          </p>
        </form>
      ) : null}
    </Panel>
  )
}
