import { useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PaydayBadge, PaydayLanded, PaydayNotice } from '@/ui/Payday'
import { normalisePayCalendar, normalisePayday } from '@/lib/payday'
import { timesheetApi, type Correction, type CorrectionInput, type TimesheetConfig } from './api'
import { DecisionPanel } from './DecisionPanel'
import { useLoad, useMediaQuery } from './hooks'
import {
  REASON_MAX,
  checkCorrection,
  correctionDayRange,
  correctionHours,
  correctionLink,
  correctionStatusLabel,
  correctionStatusTone,
  emptyCorrection,
  formatDateTimeIn,
  formatDayLong,
  formatDayLabel,
  formatHoursMinutes,
  isIsoDate,
  toProblem,
  type CorrectionDraft,
  type CorrectionField,
} from './logic'
import { Banner, ErrorBlock, LoadingCard, Pager, Pill } from './parts'

const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled'] as const

function timesText(c: Pick<Correction, 'local_clock_in' | 'local_clock_out' | 'clock_out_next_day'>): string {
  return `${c.local_clock_in} - ${c.local_clock_out}${c.clock_out_next_day ? ' (next day)' : ''}`
}

// ------------------------------------------------------------------------------------------------ form
function CorrectionForm({ config, initial, sessionId, onDone, onClose }: { config: TimesheetConfig; initial: CorrectionDraft; sessionId: string | null; onDone: (c: Correction) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<CorrectionDraft>(initial)
  const [errors, setErrors] = useState<Partial<Record<CorrectionField, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  const range = correctionDayRange(config.today, config.correction_window_days)
  const hours = correctionHours(draft)
  const set = <K extends keyof CorrectionDraft>(key: K, value: CorrectionDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (key !== 'clock_out_next_day') setErrors((e) => ({ ...e, [key]: undefined }))
    else setErrors((e) => ({ ...e, clock_out: undefined }))
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (guard.current) return
    const found = checkCorrection(draft, config.today, config.correction_window_days)
    setErrors(found)
    setGeneral(null)
    if (Object.keys(found).length > 0) return
    guard.current = true
    setBusy(true)
    const body: CorrectionInput = {
      day: draft.day,
      clock_in: draft.clock_in,
      clock_out: draft.clock_out,
      clock_out_next_day: draft.clock_out_next_day,
      reason: draft.reason.trim(),
      ...(sessionId ? { session_id: sessionId } : {}),
    }
    try {
      onDone(await timesheetApi.requestCorrection(body))
    } catch (e) {
      const p = toProblem(e, 'The correction could not be sent.')
      if (p.code === 'day_not_past' || p.code === 'day_too_old' || p.code === 'session_day_mismatch') setErrors({ day: p.detail })
      else if (p.code === 'out_before_in' || p.code === 'session_too_long') setErrors({ clock_out: p.detail })
      else setGeneral(p.status === 404 && sessionId ? 'The punch this correction refers to could not be found. Open the request again from your attendance.' : p.detail)
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad ts-form" onSubmit={submit} noValidate aria-labelledby="corr-form-title" data-testid="correction-form">
      <h2 id="corr-form-title">Request an attendance correction</h2>
      <p className="card-sub">
        For a past day (up to {config.correction_window_days} days back). Your manager reviews it; if you have none, HR does. Your original punches are never changed.
      </p>
      <PaydayNotice calendar={normalisePayCalendar(config.pay_calendar)} noun="correction" />
      {sessionId ? (
        <Banner tone="info" testId="correction-linked">
          This correction is linked to the punch that was left open. Once it is approved that punch is resolved and you can clock in again.
        </Banner>
      ) : null}
      <div className="ts-form-grid">
        <label className="ts-field">
          <span>Day</span>
          <input
            type="date"
            className="ts-input"
            value={draft.day}
            min={range.min}
            max={range.max}
            onChange={(e) => set('day', e.target.value)}
            aria-invalid={Boolean(errors.day)}
            data-testid="corr-day"
          />
          {errors.day ? (
            <span className="ts-field-error" role="alert" data-testid="corr-day-error">
              {errors.day}
            </span>
          ) : null}
        </label>
        <label className="ts-field">
          <span>Clock in (company time)</span>
          <input type="time" className="ts-input" value={draft.clock_in} onChange={(e) => set('clock_in', e.target.value)} aria-invalid={Boolean(errors.clock_in)} data-testid="corr-in" />
          {errors.clock_in ? (
            <span className="ts-field-error" role="alert">
              {errors.clock_in}
            </span>
          ) : null}
        </label>
        <label className="ts-field">
          <span>Clock out (company time)</span>
          <input type="time" className="ts-input" value={draft.clock_out} onChange={(e) => set('clock_out', e.target.value)} aria-invalid={Boolean(errors.clock_out)} data-testid="corr-out" />
          {errors.clock_out ? (
            <span className="ts-field-error" role="alert" data-testid="corr-out-error">
              {errors.clock_out}
            </span>
          ) : null}
        </label>
      </div>
      <label className="ts-check">
        <input type="checkbox" checked={draft.clock_out_next_day} onChange={(e) => set('clock_out_next_day', e.target.checked)} data-testid="corr-next-day" />
        <span>Clock-out is on the next day (night shift)</span>
      </label>
      {hours !== null ? (
        <p className="ts-muted" data-testid="corr-length">
          Proposed session: {formatHoursMinutes(hours)}.
        </p>
      ) : null}
      <label className="ts-field">
        <span>Reason</span>
        <textarea
          className="ts-input ts-textarea"
          rows={3}
          maxLength={REASON_MAX}
          value={draft.reason}
          onChange={(e) => set('reason', e.target.value)}
          aria-invalid={Boolean(errors.reason)}
          placeholder="For example: forgot to clock out"
          data-testid="corr-reason"
        />
        <span className="ts-counter">
          {draft.reason.length}/{REASON_MAX}
        </span>
        {errors.reason ? (
          <span className="ts-field-error" role="alert" data-testid="corr-reason-error">
            {errors.reason}
          </span>
        ) : null}
      </label>
      {general ? (
        <div className="ts-msg" data-testid="corr-error">
          <Alert tone="danger">{general}</Alert>
        </div>
      ) : null}
      <div className="ts-button-row">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="corr-submit">
          {busy ? 'Sending...' : 'Send for review'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-testid="corr-cancel-form">
          Close
        </button>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------------------------------------ detail
export function CorrectionDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const load = useLoad(() => timesheetApi.correction(id), [id], 'This correction could not be loaded.')
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guard = useRef(false)
  const c = load.data

  if (load.error && !c) return <ErrorBlock problem={load.error} onRetry={load.reload} what="This correction" />
  if (!c) return <LoadingCard testId="correction-loading" lines={3} />

  const tz = c.timezone
  const allowed = c.allowed_actions

  async function withdraw() {
    if (!c || guard.current) return
    guard.current = true
    setBusy(true)
    setError(null)
    try {
      load.setData(await timesheetApi.cancelCorrection(c.correction_id, c.version))
      setConfirmWithdraw(false)
      onChanged()
    } catch (e) {
      const p = toProblem(e, 'The request could not be withdrawn.')
      setError(p.detail)
      if (p.status === 409) {
        load.reload()
        onChanged()
      }
    } finally {
      guard.current = false
      setBusy(false)
    }
  }

  async function decide(action: 'approve' | 'reject', comment: string) {
    if (!c) return
    try {
      load.setData(await timesheetApi.decideCorrection(c.correction_id, { action, ...(comment ? { comment } : {}), version: c.version }))
      onChanged()
    } catch (e) {
      const p = toProblem(e, 'The decision could not be saved.')
      if (p.status === 409) {
        // Decided or changed meanwhile: show the latest (the decision panel disappears) and say why.
        setError(`${p.detail} The latest version is shown.`)
        load.reload()
        onChanged()
        return
      }
      throw e
    }
  }

  const payday = normalisePayday(c.payday)

  return (
    <div className="ts-stack" data-testid="correction-detail" data-status={c.status}>
      <section className="card card-pad" aria-labelledby="corr-detail-title">
        <div className="ts-section-head">
          <div>
            <h2 id="corr-detail-title">Correction for {formatDayLong(c.day)}</h2>
            <p className="card-sub">
              {c.employee.name} - sent {formatDateTimeIn(c.submitted_at, tz)}
            </p>
          </div>
          <div className="ts-head-actions">
            <Pill tone={correctionStatusTone(c.status)} testId="correction-status">
              {correctionStatusLabel(c.status)}
            </Pill>
            <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="correction-close">
              Close
            </button>
          </div>
        </div>
        <dl className="ts-facts">
          <div>
            <dt>Proposed times</dt>
            <dd data-testid="correction-times">{timesText(c)}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{formatHoursMinutes(c.hours)}</dd>
          </div>
          <div>
            <dt>Reviewer</dt>
            <dd>{c.approver.kind === 'manager' ? (c.approver.name ?? 'Your manager') : 'HR (no manager to route to)'}</dd>
          </div>
          {payday ? (
            <div>
              <dt>Payday</dt>
              <dd>
                <PaydayBadge payday={payday} testId="correction-payday" />
              </dd>
            </div>
          ) : null}
          <div className="ts-fact-wide">
            <dt>Reason</dt>
            <dd className="ts-prewrap" data-testid="correction-reason">
              {c.reason}
            </dd>
          </div>
        </dl>
        <PaydayLanded payday={payday} noun="correction" />
        {c.decision ? (
          <Banner tone={c.decision.action === 'approve' ? 'success' : 'danger'} title={`${c.decision.action === 'approve' ? 'Approved' : 'Rejected'} by ${c.decision.by.name}`} testId="correction-decision">
            {c.decision.comment ? <span className="ts-prewrap">{c.decision.comment}</span> : 'No comment.'}
          </Banner>
        ) : null}
        {c.status === 'cancelled' ? <p className="ts-muted">This request was withdrawn.</p> : null}
        {error ? (
          <div className="ts-msg" data-testid="correction-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        {allowed.includes('cancel') ? (
          confirmWithdraw ? (
            <div className="ts-confirm" role="group" aria-label="Confirm withdrawing" data-testid="withdraw-confirm-box">
              <span>Withdraw this request?</span>
              <button type="button" className="btn ts-btn-danger" onClick={withdraw} disabled={busy} data-testid="withdraw-confirm">
                {busy ? 'Withdrawing...' : 'Yes, withdraw'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmWithdraw(false)} disabled={busy}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="ts-button-row">
              <button type="button" className="btn ts-btn-danger-outline" onClick={() => setConfirmWithdraw(true)} data-testid="withdraw">
                Withdraw request
              </button>
            </div>
          )
        ) : null}
      </section>
      <DecisionPanel subject="correction" allowed={allowed} onDecide={decide} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ tab
export function CorrectionsTab({ config }: { config: TimesheetConfig }) {
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 640px)')
  const status = (STATUS_FILTERS as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as string) : ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const id = (params.get('id') ?? '').trim() || null
  const wantsForm = params.get('new') === '1'
  const prefillDay = isIsoDate(params.get('day')) ? (params.get('day') as string) : ''
  const sessionId = /^[A-Za-z0-9_-]{8,64}$/.test(params.get('session_id') ?? '') ? (params.get('session_id') as string) : null
  const [created, setCreated] = useState<string | null>(null)

  const list = useLoad(() => timesheetApi.corrections('mine', status || undefined, page), [status, page], 'Your corrections could not be loaded.')

  const update = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'corrections')
    mutate(p)
    setParams(p, { replace: true })
  }
  const openForm = () =>
    update((p) => {
      p.set('new', '1')
      p.delete('id')
    })
  const closeForm = () =>
    update((p) => {
      p.delete('new')
      p.delete('day')
      p.delete('session_id')
    })
  const showDetail = (cid: string) =>
    update((p) => {
      p.set('id', cid)
      p.delete('new')
      p.delete('day')
      p.delete('session_id')
    })
  const closeDetail = () => update((p) => p.delete('id'))
  const reload = list.reload

  return (
    <div className="ts-stack" data-testid="tab-corrections">
      {id ? <CorrectionDetail id={id} onClose={closeDetail} onChanged={reload} /> : null}

      {wantsForm && !id ? (
        <CorrectionForm
          key={`${prefillDay}|${sessionId ?? ''}`}
          config={config}
          initial={{ ...emptyCorrection(), day: prefillDay }}
          sessionId={sessionId}
          onClose={closeForm}
          onDone={(c) => {
            setCreated(c.correction_id)
            reload()
            showDetail(c.correction_id)
          }}
        />
      ) : null}

      {created && !wantsForm ? (
        <Banner tone="success" testId="correction-sent">
          Your correction was sent for review.
        </Banner>
      ) : null}

      <section className="card card-pad" aria-labelledby="corr-list-title">
        <div className="ts-section-head">
          <div>
            <h2 id="corr-list-title">My correction requests</h2>
            <p className="card-sub">Use this when a punch is missing, wrong or was left open. You can withdraw a request until it is decided.</p>
          </div>
          <div className="ts-head-actions">
            <label className="ts-filter">
              <span className="sr-only">Filter by status</span>
              <select className="ts-input" value={status} onChange={(e) =>
                  update((p) => {
                    if (e.target.value) p.set('status', e.target.value)
                    else p.delete('status')
                    p.delete('page')
                  })
                }
                aria-label="Filter by status" data-testid="corr-filter">
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {correctionStatusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            {!wantsForm ? (
              <button type="button" className="btn btn-primary" onClick={openForm} data-testid="open-correction-form">
                <Plus size={16} aria-hidden="true" /> Request a correction
              </button>
            ) : null}
          </div>
        </div>
        {list.error && !list.data ? (
          <ErrorBlock problem={list.error} onRetry={list.reload} what="Your corrections" />
        ) : !list.data ? (
          <LoadingCard testId="corr-loading" lines={3} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            plain
            title={status ? 'No requests with this status' : 'No correction requests yet'}
            body={status ? 'Try another status.' : 'If a punch is missing or wrong, request a correction from your attendance month or with the button above.'}
          />
        ) : phone ? (
          <ul className="ts-day-cards" data-testid="corr-cards">
            {list.data.items.map((c) => (
              <li key={c.correction_id} className="ts-day-card" data-testid="corr-card" data-status={c.status}>
                <div className="ts-day-card-top">
                  <strong>{formatDayLabel(c.day)}</strong>
                  <Pill tone={correctionStatusTone(c.status)}>{correctionStatusLabel(c.status)}</Pill>
                </div>
                <div className="ts-day-card-row">
                  <span>{timesText(c)}</span>
                  <span className="ts-day-card-hours">{formatHoursMinutes(c.hours)}</span>
                </div>
                <PaydayBadge payday={normalisePayday(c.payday)} testId="corr-payday" />
                <Link to={correctionLink(c.correction_id)} className="btn btn-secondary" data-testid="corr-open">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card ts-table-card">
            <table className="ts-table" data-testid="corr-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Proposed times</th>
                  <th scope="col" className="ts-num">
                    Length
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Sent</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.correction_id} data-testid="corr-row" data-status={c.status} data-id={c.correction_id}>
                    <th scope="row" className="ts-day-cell">
                      {formatDayLabel(c.day)}
                    </th>
                    <td>{timesText(c)}</td>
                    <td className="ts-num">{formatHoursMinutes(c.hours)}</td>
                    <td>
                      <Pill tone={correctionStatusTone(c.status)}>{correctionStatusLabel(c.status)}</Pill>
                      <PaydayBadge payday={normalisePayday(c.payday)} testId="corr-payday" />
                    </td>
                    <td className="ts-muted">{formatDateTimeIn(c.submitted_at, c.timezone)}</td>
                    <td className="ts-actions-cell">
                      <Link to={correctionLink(c.correction_id)} className="ts-link" data-testid="corr-open">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data ? (
          <Pager
            page={list.data.page}
            pageSize={list.data.page_size}
            total={list.data.total}
            onPage={(n) => update((p) => (n <= 1 ? p.delete('page') : p.set('page', String(n))))}
          />
        ) : null}
      </section>
    </div>
  )
}
