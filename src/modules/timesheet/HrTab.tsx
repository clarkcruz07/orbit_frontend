import { useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { timesheetApi, type Code, type TimesheetConfig } from './api'
import { useLoad } from './hooks'
import { formatWeekRange, isIsoDate, mondayOf, toProblem } from './logic'
import { Banner, ErrorBlock, LoadingCard } from './parts'
import { WeekNav } from './TimesheetTab'

function Overview({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const rawWeek = params.get('week')
  const week = isIsoDate(rawWeek) ? mondayOf(rawWeek) : config.current_week_start
  const q = useLoad(() => timesheetApi.overview(week), [week], 'The overview could not be loaded.')
  const goWeek = (m: string) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'hr')
    if (m === config.current_week_start) p.delete('week')
    else p.set('week', m)
    setParams(p, { replace: true })
  }
  const d = q.data
  const cards: { id: string; label: string; value: number | undefined; hint?: string }[] = [
    { id: 'open', label: 'Open', value: d?.counts.open, hint: 'Saved, not submitted' },
    { id: 'submitted', label: 'Submitted', value: d?.counts.submitted, hint: 'Waiting for a decision' },
    { id: 'approved', label: 'Approved', value: d?.counts.approved },
    { id: 'rejected', label: 'Rejected', value: d?.counts.rejected, hint: 'Sent back to the employee' },
    { id: 'no_sheet', label: 'No timesheet', value: d?.no_sheet, hint: 'Nothing saved for this week' },
    { id: 'pending_corrections', label: 'Corrections pending', value: d?.pending_corrections, hint: 'All weeks' },
  ]
  return (
    <section className="card card-pad" aria-labelledby="hr-overview-title" data-testid="hr-overview">
      <div className="ts-section-head">
        <div>
          <h2 id="hr-overview-title">Week overview</h2>
          <p className="card-sub">Counts only, no names. Read-only: HR reads everything but decides only items that have no manager to go to.</p>
        </div>
        <WeekNav week={week} currentWeek={config.current_week_start} onWeek={goWeek} />
      </div>
      {q.error && !q.data ? (
        <ErrorBlock problem={q.error} onRetry={q.reload} what="The overview" />
      ) : !d ? (
        <LoadingCard testId="overview-loading" lines={3} />
      ) : (
        <>
          <p className="ts-muted" data-testid="overview-meta">
            Week of {formatWeekRange(d.week_start)}. {d.active_employees} active {d.active_employees === 1 ? 'employee' : 'employees'}.
          </p>
          <ul className="ts-stats" data-testid="overview-stats">
            {cards.map((c) => (
              <li key={c.id} className="ts-stat" data-testid={`stat-${c.id}`}>
                <span className="ts-stat-value">{c.value ?? '-'}</span>
                <span className="ts-stat-label">{c.label}</span>
                {c.hint ? <span className="ts-stat-hint">{c.hint}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function CodeRow({ code, onSaved }: { code: Code; onSaved: () => void }) {
  const [name, setName] = useState(code.name)
  const [billable, setBillable] = useState(code.billable)
  const [active, setActive] = useState(code.active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const guard = useRef(false)
  const changed = name.trim() !== code.name || billable !== code.billable || active !== code.active
  const valid = name.trim().length > 0 && name.trim().length <= 60

  async function save() {
    if (guard.current || !valid || !changed) return
    guard.current = true
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await timesheetApi.updateCode(code.code_id, { name: name.trim(), billable, active, version: code.version })
      setSaved(true)
      onSaved()
    } catch (e) {
      const p = toProblem(e, 'The code could not be saved.')
      setError(p.detail)
      if (p.status === 409 && !p.code) onSaved()
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  return (
    <li className={`ts-code-row${code.active ? '' : ' inactive'}`} data-testid="code-row" data-code={code.code_id}>
      <label className="ts-field ts-code-name-field">
        <span className="sr-only">Name of {code.code_id}</span>
        <input className="ts-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={`Name of ${code.code_id}`} data-testid="code-name" />
      </label>
      <label className="ts-check">
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} data-testid="code-billable" />
        <span>Billable</span>
      </label>
      <label className="ts-check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="code-active" />
        <span>Active</span>
      </label>
      <button type="button" className="btn btn-secondary" onClick={save} disabled={busy || !changed || !valid} data-testid="code-save">
        {busy ? 'Saving...' : 'Save'}
      </button>
      {error ? (
        <div className="ts-code-msg" data-testid="code-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : saved && !changed ? (
        <span className="ts-ok ts-code-msg" role="status">
          Saved.
        </span>
      ) : null}
    </li>
  )
}

function CodeAdmin({ onChanged }: { onChanged: () => void }) {
  const q = useLoad(() => timesheetApi.codes(true), [], 'The code catalog could not be loaded.')
  const [name, setName] = useState('')
  const [billable, setBillable] = useState(false)
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = useRef(false)

  async function create(ev: FormEvent) {
    ev.preventDefault()
    if (guard.current) return
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) {
      setError('Enter a name for the code.')
      return
    }
    if (clean.length > 60) {
      setError('Keep the name under 60 characters.')
      return
    }
    guard.current = true
    setBusy(true)
    setError(null)
    try {
      await timesheetApi.createCode({ name: clean, billable, active })
      setName('')
      setBillable(false)
      setActive(true)
      q.reload()
      onChanged()
    } catch (e) {
      setError(toProblem(e, 'The code could not be created.').detail)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  const refresh = () => {
    q.reload()
    onChanged()
  }

  return (
    <section className="card card-pad" aria-labelledby="codes-title" data-testid="code-admin">
      <h2 id="codes-title">Timesheet codes</h2>
      <p className="card-sub">The catalog people pick from on their timesheet.</p>
      {q.error && !q.data ? (
        <ErrorBlock problem={q.error} onRetry={q.reload} what="The code catalog" />
      ) : !q.data ? (
        <LoadingCard testId="codes-loading" lines={3} />
      ) : !q.data.can_manage ? (
        <Banner tone="info" testId="codes-readonly">
          You can read the catalog but not change it.
        </Banner>
      ) : (
        <>
          <ul className="ts-code-list" data-testid="code-list">
            {q.data.items.map((c) => (
              <CodeRow key={c.code_id} code={c} onSaved={refresh} />
            ))}
          </ul>
          <form className="ts-code-new" onSubmit={create} noValidate aria-label="New code" data-testid="code-create-form">
            <label className="ts-field ts-code-name-field">
              <span>New code name</span>
              <input className="ts-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="new-code-name" />
            </label>
            <label className="ts-check">
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} data-testid="new-code-billable" />
              <span>Billable</span>
            </label>
            <label className="ts-check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="new-code-active" />
              <span>Active</span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="new-code-submit">
              <Plus size={16} aria-hidden="true" /> {busy ? 'Adding...' : 'Add code'}
            </button>
          </form>
          {error ? (
            <div className="ts-msg" data-testid="new-code-error">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          <p className="ts-fine">A code that is already on a timesheet is deactivated instead of deleted: it stays valid on existing rows and cannot be added to new ones.</p>
        </>
      )}
    </section>
  )
}

export function HrTab({ config, onCodesChanged }: { config: TimesheetConfig; onCodesChanged: () => void }) {
  return (
    <div className="ts-stack" data-testid="tab-hr">
      <Overview config={config} />
      <CodeAdmin onChanged={onCodesChanged} />
    </div>
  )
}
