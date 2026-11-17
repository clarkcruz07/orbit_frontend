import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarCheck, CheckCircle2 } from 'lucide-react'
import { leaveApi, type BalancesResponse, type LeaveType, type Preview } from './api'
import {
  HALF_LABEL,
  dayNumber,
  REASON_MAX,
  applyFormChange,
  balanceSentence,
  friendlyError,
  halfDayAllowed,
  parseLeaveError,
  previewBalanceText,
  previewHeadline,
  previewNotes,
  previewQuery,
  typeSummary,
  type FormContext,
  type FormErrors,
  type FormValues,
} from './logic'
import { Spinner } from './parts'
import type { HalfDay } from './api'

interface Props {
  values: FormValues
  onChange: (next: FormValues) => void
  /** Errors to display (the parent decides when to reveal them). */
  errors: FormErrors
  types: LeaveType[]
  ctx: FormContext
  disabled?: boolean
  /** Prefix for element ids so two forms never collide. */
  idPrefix?: string
}

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; last: Preview | null }
  | { kind: 'ready'; preview: Preview }
  | { kind: 'error'; message: string }

const HALF_OPTIONS: HalfDay[] = ['none', 'am', 'pm']
const PREVIEW_DELAY_MS = 300

/** Debounced `GET /leave/preview`: never writes anything. Requests are aborted when the inputs change. */
export function usePreview(values: FormValues, ctx: FormContext): PreviewState {
  const query = useMemo(() => previewQuery(values, ctx), [values.typeId, values.start, values.end, values.half, ctx.today, ctx.types, ctx.windowDays, ctx.maxSpan]) // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<PreviewState>({ kind: 'idle' })
  const lastRef = useRef<Preview | null>(null)
  useEffect(() => {
    if (!query) {
      lastRef.current = null
      setState({ kind: 'idle' })
      return
    }
    const ctl = new AbortController()
    let live = true
    setState({ kind: 'loading', last: lastRef.current })
    const timer = window.setTimeout(() => {
      leaveApi
        .preview(query, ctl.signal)
        .then((preview) => {
          if (!live) return
          lastRef.current = preview
          setState({ kind: 'ready', preview })
        })
        .catch((e) => {
          if (!live || ctl.signal.aborted) return
          lastRef.current = null
          setState({ kind: 'error', message: friendlyError(parseLeaveError(e, 'The day count could not be calculated.')) })
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      live = false
      ctl.abort()
      window.clearTimeout(timer)
    }
  }, [query])
  return state
}

/** Balances of the year the request starts in, so the person sees what they have before asking. */
function useBalances(year: number | null) {
  const [data, setData] = useState<BalancesResponse | null>(null)
  useEffect(() => {
    if (year === null) return
    let live = true
    leaveApi
      .balances(year)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [year])
  return data
}

function PreviewPanel({ state, paid }: { state: PreviewState; paid: boolean }) {
  const shown = state.kind === 'ready' ? state.preview : state.kind === 'loading' ? state.last : null
  return (
    <section className={`lv-preview${state.kind === 'loading' ? ' loading' : ''}`} aria-labelledby="lv-preview-h" aria-live="polite" data-testid="leave-preview" data-state={state.kind === 'ready' ? (state.preview.valid ? 'valid' : 'issues') : state.kind}>
      <h3 id="lv-preview-h">Day count</h3>
      {state.kind === 'idle' ? <p className="lv-muted">Choose a leave type and dates to see how many days this will use.</p> : null}
      {state.kind === 'error' ? (
        <p className="lv-preview-error" role="alert" data-testid="preview-error">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'loading' && !shown ? <Spinner label="Counting working days..." /> : null}
      {shown ? (
        <>
          <p className="lv-preview-days" data-testid="preview-days" data-days={shown.days}>
            <CalendarCheck size={18} aria-hidden="true" /> {previewHeadline(shown)}
            {state.kind === 'loading' ? <span className="lv-muted"> (updating...)</span> : null}
          </p>
          {previewNotes(shown).length > 0 ? (
            <ul className="lv-preview-notes" data-testid="preview-notes">
              {previewNotes(shown).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {shown.balance.length > 0 ? (
            <ul className="lv-preview-balance" data-testid="preview-balance">
              {shown.balance.map((row) => (
                <li key={row.year}>{previewBalanceText(row, paid)}</li>
              ))}
            </ul>
          ) : null}
          {shown.issues.length > 0 ? (
            <ul className="lv-preview-issues" data-testid="preview-issues">
              {shown.issues.map((i) => (
                <li key={i.code} data-testid="preview-issue" data-code={i.code}>
                  <AlertTriangle size={15} aria-hidden="true" /> <span>{i.message}</span>
                </li>
              ))}
            </ul>
          ) : state.kind === 'ready' ? (
            <p className="lv-preview-ok" data-testid="preview-ok">
              <CheckCircle2 size={15} aria-hidden="true" /> No problems found with these dates.
            </p>
          ) : null}
          {shown.issues.length > 0 ? <p className="lv-muted lv-preview-foot">The server checks again when you submit and will refuse a request that breaks these rules.</p> : null}
        </>
      ) : null}
    </section>
  )
}

/** Fields shared by "New request" and "Edit after clarification". The parent owns state, validation timing and the buttons. */
export function LeaveForm({ values, onChange, errors, types, ctx, disabled = false, idPrefix = 'lv' }: Props) {
  const type = types.find((t) => t.type_id === values.typeId)
  const startYear = dayNumber(values.start) !== null ? Number(values.start.slice(0, 4)) : Number((ctx.today ?? '').slice(0, 4)) || null
  const balances = useBalances(startYear)
  const sentence = balanceSentence(balances?.items.find((b) => b.type_id === values.typeId), balances?.year ?? 0)
  const preview = usePreview(values, ctx)
  const halfOk = halfDayAllowed(values)
  const reasonRequired = Boolean(type?.requires_reason)
  const set = (patch: Partial<FormValues>) => onChange(applyFormChange(values, patch))
  const id = (s: string) => `${idPrefix}-${s}`

  return (
    <div className="lv-form-grid">
      <div className="lv-form-fields">
        <div className={`lv-field${errors.type ? ' has-error' : ''}`}>
          <label className="lv-label" htmlFor={id('type')}>
            Leave type <span className="lv-req" aria-hidden="true">*</span>
          </label>
          <select id={id('type')} className="lv-input" value={values.typeId} disabled={disabled} onChange={(e) => set({ typeId: e.target.value })} data-testid="leave-type" aria-invalid={Boolean(errors.type)} aria-describedby={id('type-help')}>
            <option value="">Select a type</option>
            {types.map((t) => (
              <option key={t.type_id} value={t.type_id} disabled={!t.active}>
                {t.name}
                {t.active ? '' : ' (no longer available)'}
              </option>
            ))}
          </select>
          <p className="lv-help" id={id('type-help')} data-testid="type-help">
            {type ? `${typeSummary(type)}.` : 'Choose a leave type.'}
          </p>
          {sentence && values.typeId ? (
            <p className="lv-balance-line" data-testid="form-balance">
              {sentence}
            </p>
          ) : null}
          <p className="lv-field-error" role="alert" data-testid="error-type">
            {errors.type}
          </p>
        </div>

        <div className="lv-date-row">
          <div className={`lv-field${errors.start ? ' has-error' : ''}`}>
            <label className="lv-label" htmlFor={id('start')}>
              Start date <span className="lv-req" aria-hidden="true">*</span>
            </label>
            <input id={id('start')} type="date" className="lv-input" value={values.start} disabled={disabled} onChange={(e) => set({ start: e.target.value })} data-testid="leave-start" aria-invalid={Boolean(errors.start)} />
            <p className="lv-field-error" role="alert" data-testid="error-start">
              {errors.start}
            </p>
          </div>
          <div className={`lv-field${errors.end ? ' has-error' : ''}`}>
            <label className="lv-label" htmlFor={id('end')}>
              End date <span className="lv-req" aria-hidden="true">*</span>
            </label>
            <input id={id('end')} type="date" className="lv-input" value={values.end} min={values.start || undefined} disabled={disabled} onChange={(e) => set({ end: e.target.value })} data-testid="leave-end" aria-invalid={Boolean(errors.end)} />
            <p className="lv-field-error" role="alert" data-testid="error-end">
              {errors.end}
            </p>
          </div>
        </div>

        <fieldset className={`lv-field lv-half${errors.half ? ' has-error' : ''}`} disabled={disabled}>
          <legend className="lv-label">Part of the day</legend>
          <div className="lv-radio-row">
            {HALF_OPTIONS.map((h) => (
              <label key={h} className={`lv-radio${!halfOk && h !== 'none' ? ' disabled' : ''}`}>
                <input type="radio" name={id('half')} value={h} checked={values.half === h} disabled={!halfOk && h !== 'none'} onChange={() => set({ half: h })} data-testid={`leave-half-${h}`} />
                <span>{HALF_LABEL[h]}</span>
              </label>
            ))}
          </div>
          <p className="lv-help" data-testid="half-help">
            {halfOk ? 'A half day counts as 0.5 day.' : 'Half days are only for a single day: set the start and end date to the same day to choose one.'}
          </p>
          <p className="lv-field-error" role="alert" data-testid="error-half">
            {errors.half}
          </p>
        </fieldset>

        <div className={`lv-field${errors.reason ? ' has-error' : ''}`}>
          <label className="lv-label" htmlFor={id('reason')}>
            Reason {reasonRequired ? <span className="lv-req" aria-hidden="true">*</span> : <span className="lv-opt">(optional)</span>}
          </label>
          <textarea id={id('reason')} className="lv-input lv-textarea" rows={3} maxLength={REASON_MAX} value={values.reason} disabled={disabled} onChange={(e) => set({ reason: e.target.value })} data-testid="leave-reason" aria-invalid={Boolean(errors.reason)} aria-describedby={id('reason-help')} />
          <div className="lv-help-row" id={id('reason-help')}>
            <span>{reasonRequired ? 'This leave type needs a reason.' : 'Your approver and HR can read this. It is never sent in notifications.'}</span>
            <span className="lv-counter" data-over={values.reason.length > REASON_MAX ? 'true' : 'false'} data-testid="reason-counter">
              {values.reason.length}/{REASON_MAX}
            </span>
          </div>
          <p className="lv-field-error" role="alert" data-testid="error-reason">
            {errors.reason}
          </p>
        </div>
      </div>

      <aside className="lv-form-side">
        <PreviewPanel state={preview} paid={type?.paid ?? true} />
      </aside>
    </div>
  )
}

/** A link to the person's own overlapping request (the API returns its id with the 409). */
export function ConflictLink({ id }: { id: string }) {
  return (
    <Link to={`/leave/${id}`} className="lv-conflict-link" data-testid="conflict-link">
      View the overlapping request
    </Link>
  )
}
