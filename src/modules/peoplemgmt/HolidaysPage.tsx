import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Plus, ShieldOff } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { type Holiday, type HolidaysResponse, holidaysApi, parseFailure } from './api'
import {
  HOLIDAYS_AI_NOTE,
  HOLIDAYS_EMPTY_NOTE,
  HOLIDAYS_FAILED_NOTE,
  HOLIDAYS_PENDING_NOTE,
  HOLIDAYS_USAGE_NOTE,
  HOLIDAY_YEAR_MAX,
  HOLIDAY_YEAR_MIN,
  failureMessage,
  holidayDateText,
  holidayTypeLabel,
  inYear,
  otherYearsCount,
  parseYear,
  repeatText,
  yearOptions,
} from './logic'
import { HolidayFormCard } from './HolidayForm'
import { ErrorBlock, LoadingCard, Modal, Notice, Pill } from './parts'
import '@/pages/pages.css'
import './peoplemgmt.css'

type Load = { kind: 'loading' } | { kind: 'ready'; res: HolidaysResponse } | { kind: 'error'; message: string } | { kind: 'denied' }
type Editor = null | { holiday: Holiday | null }

const POLL_MS = 3000
const POLL_LIMIT = 10

/** HR: the company holiday list, by year. The calendar and leave day-counting both read it. */
export function HolidaysPage() {
  const now = useMemo(() => new Date(), [])
  const [params, setParams] = useSearchParams()
  const year = parseYear(params.get('year'), now)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [editor, setEditor] = useState<Editor>(null)
  const [confirm, setConfirm] = useState<Holiday | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** While the server fetches this year's holidays on its own, look again every few seconds (a handful of times). */
  const polls = useRef(0)

  const setYear = useCallback(
    (next: number) => {
      const y = Math.min(HOLIDAY_YEAR_MAX, Math.max(HOLIDAY_YEAR_MIN, next))
      setEditor(null)
      setNotice(null)
      polls.current = 0
      setParams(y === now.getFullYear() ? new URLSearchParams() : new URLSearchParams({ year: String(y) }))
    },
    [now, setParams],
  )

  useEffect(() => {
    const ctl = new AbortController()
    // Reloading the SAME year (after a save) keeps the list on screen; another year starts from the loading state.
    setLoad((prev) => (prev.kind === 'ready' && prev.res.year === year ? prev : { kind: 'loading' }))
    let timer: ReturnType<typeof setTimeout> | undefined
    ;(async () => {
      // HR asks for inactive ones too.
      const res = await holidaysApi.list(year, true, ctl.signal)
      if (ctl.signal.aborted) return
      setLoad({ kind: 'ready', res })
      if (res.sync === 'pending' && polls.current < POLL_LIMIT) {
        timer = setTimeout(() => {
          polls.current += 1
          setAttempt((n) => n + 1)
        }, POLL_MS)
      }
    })().catch((err) => {
      if (ctl.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return
      const f = parseFailure(err)
      setLoad(f.status === 403 ? { kind: 'denied' } : { kind: 'error', message: failureMessage(f, 'The holidays could not be loaded.') })
    })
    return () => {
      ctl.abort()
      if (timer) clearTimeout(timer)
    }
  }, [year, attempt])

  const reload = () => setAttempt((n) => n + 1)

  function saved(h: Holiday, message: string) {
    setEditor(null)
    // A one-off in another year is not on this page: jump to its year so the person sees what they just saved.
    const target = h.date ? Number(h.date.slice(0, 4)) : year
    if (h.date && target !== year && target >= HOLIDAY_YEAR_MIN && target <= HOLIDAY_YEAR_MAX) {
      setNotice(`${message} It falls in ${target}, so that year is shown now.`)
      setParams(new URLSearchParams({ year: String(target) }))
    } else {
      setNotice(message)
      reload()
    }
  }

  const back = (
    <p className="pm-back">
      <Link to="/settings?tab=catalogs" className="pm-back-link" data-testid="back-to-settings">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Settings
      </Link>
    </p>
  )

  if (load.kind === 'denied') {
    return (
      <div className="page pm-page" data-testid="holidays-denied">
        {back}
        <EmptyState icon={<ShieldOff size={28} />} title="Holiday settings are not available" body="Only HR administrators can manage the company holidays. Everyone can see them on the Company Calendar." action={<Link to="/company-calendar" className="btn btn-primary">Open the calendar</Link>} />
      </div>
    )
  }

  const years = yearOptions(year, now)
  // Data for another year (the render between a year change and the effect that starts the reload) is never shown under the new year's name.
  const res = load.kind === 'ready' && load.res.year === year ? load.res : null
  const items = res ? inYear(res.items) : []
  const hidden = res ? otherYearsCount(res.items) : 0

  return (
    <div className="page pm-page" data-testid="holidays-page" data-year={year}>
      {back}
      <PageTitle title="Holidays" subtitle="The company holiday list used by the Company Calendar and by leave day-counting." />

      <Notice testId="holidays-usage-note">{HOLIDAYS_USAGE_NOTE}</Notice>

      <div className="pm-year-bar" data-testid="year-bar">
        <button type="button" className="btn btn-secondary" onClick={() => setYear(year - 1)} disabled={year <= HOLIDAY_YEAR_MIN} aria-label="Previous year" data-testid="year-prev">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <label className="pm-select pm-year-select">
          <span className="sr-only">Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" data-testid="year-select">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => setYear(year + 1)} disabled={year >= HOLIDAY_YEAR_MAX} aria-label="Next year" data-testid="year-next">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <span className="pm-year-spacer" />
        {editor === null ? (
          <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setEditor({ holiday: null }) }} data-testid="add-holiday">
            <Plus size={16} aria-hidden="true" /> Add holiday
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="pm-notice-row" data-testid="holiday-notice">
          <Alert tone="info">{notice}</Alert>
        </div>
      ) : null}

      {editor ? <HolidayFormCard key={editor.holiday?.holiday_id ?? 'new'} holiday={editor.holiday} year={year} onSaved={saved} onCancel={() => setEditor(null)} /> : null}

      {load.kind === 'loading' || (load.kind === 'ready' && !res) ? <LoadingCard testId="holidays-loading" label="Loading holidays" /> : null}
      {load.kind === 'error' ? <ErrorBlock message={load.message} onRetry={reload} testId="holidays-error" /> : null}

      {res && res.sync === 'pending' ? <Notice testId="holidays-pending-note">{HOLIDAYS_PENDING_NOTE}</Notice> : null}
      {res && res.sync === 'failed' && res.items.length === 0 ? <Notice tone="warning" testId="holidays-failed-note">{HOLIDAYS_FAILED_NOTE}</Notice> : null}
      {res && res.items.some((h) => h.source === 'ai') ? <Notice tone="warning" testId="holidays-ai-note">{HOLIDAYS_AI_NOTE}</Notice> : null}
      {res && res.sync !== 'pending' && res.items.length === 0 ? <Notice tone="warning" testId="holidays-empty-note">{HOLIDAYS_EMPTY_NOTE}</Notice> : null}

      {res && items.length === 0 && !editor && res.items.length > 0 ? (
        <EmptyState
          icon={<CalendarDays size={28} />}
          title={`No holidays in ${year}`}
          body="Nothing is listed for this year. Add a holiday, or pick another year."
          action={<button type="button" className="btn btn-primary" onClick={() => setEditor({ holiday: null })}>Add holiday</button>}
        />
      ) : null}

      {res && res.sync !== 'pending' && items.length === 0 && !editor && res.items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={28} />}
          title="No holidays yet"
          body="Add the first holiday for your company."
          action={<button type="button" className="btn btn-primary" onClick={() => setEditor({ holiday: null })} data-testid="add-first-holiday">Add holiday</button>}
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <p className="pm-count" role="status" data-testid="holidays-count">
            {items.length} {items.length === 1 ? 'holiday' : 'holidays'} in {year}
          </p>
          <div className="card pm-table-card" data-testid="holidays-table">
            <table className="pm-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Holiday</th>
                  <th scope="col">Type</th>
                  <th scope="col">Repeats</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((h) => (
                  <tr key={h.holiday_id ?? h.name} data-testid="holiday-row" data-id={h.holiday_id ?? ''} data-active={h.active ? 'true' : 'false'}>
                    <td className="pm-nowrap">{holidayDateText(h)}</td>
                    <td>
                      <strong className="pm-wrap">{h.name}</strong>
                      {h.source === 'ai' ? <> <Pill tone="violet" title="Filled in automatically by AI. Edit it to confirm it.">AI</Pill></> : null}
                    </td>
                    <td>
                      <Pill tone={h.type === 'public' ? 'blue' : 'violet'}>{holidayTypeLabel(h.type)}</Pill>
                    </td>
                    <td>{repeatText(h)}</td>
                    <td>
                      <Pill tone={h.active ? 'green' : 'neutral'}>{h.active ? 'Active' : 'Inactive'}</Pill>
                    </td>
                    <td>
                      <div className="pm-row-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { setNotice(null); setEditor({ holiday: h }) }} data-testid="edit-holiday" aria-label={`Edit ${h.name}`}>
                        Edit
                      </button>
                      <button type="button" className="btn pm-btn-danger" onClick={() => setConfirm(h)} data-testid="delete-holiday" aria-label={`Delete ${h.name}`}>
                        Delete
                      </button>
                    </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="pm-cards" data-testid="holidays-cards">
            {items.map((h) => (
              <li key={h.holiday_id ?? h.name} className="card pm-card pm-card-static" data-testid="holiday-card">
                <span className="pm-card-text">
                  <strong className="pm-wrap">{h.name}</strong>
                  {h.source === 'ai' ? <Pill tone="violet" title="Filled in automatically by AI. Edit it to confirm it.">AI</Pill> : null}
                  <span className="pm-card-meta">{holidayDateText(h)}</span>
                  <span className="pm-card-meta">{repeatText(h)}</span>
                  <span className="pm-card-pills">
                    <Pill tone={h.type === 'public' ? 'blue' : 'violet'}>{holidayTypeLabel(h.type)}</Pill>
                    <Pill tone={h.active ? 'green' : 'neutral'}>{h.active ? 'Active' : 'Inactive'}</Pill>
                  </span>
                  <span className="pm-card-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => { setNotice(null); setEditor({ holiday: h }) }} aria-label={`Edit ${h.name}`}>
                      Edit
                    </button>
                    <button type="button" className="btn pm-btn-danger" onClick={() => setConfirm(h)} aria-label={`Delete ${h.name}`}>
                      Delete
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {hidden > 0 ? (
        <p className="pm-muted pm-other-years" data-testid="other-years">
          {hidden} one-off {hidden === 1 ? 'holiday falls' : 'holidays fall'} in other years. Change the year to see {hidden === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      {confirm ? <DeleteDialog holiday={confirm} onClose={() => setConfirm(null)} onDone={() => { setConfirm(null); setNotice(`${confirm.name} was deleted.`); reload() }} /> : null}
    </div>
  )
}

function DeleteDialog({ holiday, onClose, onDone }: { holiday: Holiday; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy || !holiday.holiday_id) return
    setBusy(true)
    setError(null)
    try {
      await holidaysApi.remove(holiday.holiday_id)
      onDone()
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'The holiday could not be deleted.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Delete ${holiday.name}?`} onClose={onClose} busy={busy} testId="delete-dialog">
      <ul className="pm-consequences">
        <li>It is removed from the list for good. If you only want it to stop counting, edit it and untick Active instead.</li>
        <li>From now on that day is no longer treated as a holiday in the calendar or in leave day-counting. Leave requests that already exist are not recalculated.</li>
      </ul>
      {error ? (
        <div className="pm-dialog-error" data-testid="dialog-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus data-testid="dialog-cancel">
          Cancel
        </button>
        <button type="button" className="btn pm-btn-danger" onClick={run} disabled={busy} data-testid="delete-confirm">
          {busy ? 'Deleting...' : 'Delete holiday'}
        </button>
      </div>
    </Modal>
  )
}
