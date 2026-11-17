import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Send, Undo2, Save } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Alert } from '@/ui/Feedback'
import { timesheetApi, type Code, type Sheet, type TimesheetConfig } from './api'
import { DecisionPanel } from './DecisionPanel'
import { useLoad, useMediaQuery } from './hooks'
import {
  CELL_MESSAGE,
  MAX_ROWS,
  addDaysIso,
  computeTotals,
  emptyRow,
  formatDateTimeIn,
  formatDayLabel,
  formatHours,
  formatWeekRange,
  gridDirty,
  gridFromRows,
  parseTimesheetTarget,
  sheetIdFor,
  sheetStatusLabel,
  sheetStatusTone,
  toPayloadRows,
  toProblem,
  validateGrid,
  weekNavLimits,
  type GridRow,
} from './logic'
import { Banner, ErrorBlock, LoadingCard, Pill } from './parts'
import { SheetGrid } from './SheetGrid'

// ------------------------------------------------------------------------------------------------ week navigation
export function WeekNav({ week, currentWeek, onWeek }: { week: string; currentWeek: string; onWeek: (monday: string) => void }) {
  const { canPrev, canNext } = weekNavLimits(week, currentWeek)
  return (
    <div className="ts-nav" role="group" aria-label="Week" data-testid="week-nav">
      <button type="button" className="btn btn-secondary ts-nav-btn" disabled={!canPrev} onClick={() => onWeek(addDaysIso(week, -7))} aria-label="Previous week" data-testid="week-prev">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <strong className="ts-nav-label" data-testid="week-label">
        {formatWeekRange(week)}
      </strong>
      <button type="button" className="btn btn-secondary ts-nav-btn" disabled={!canNext} onClick={() => onWeek(addDaysIso(week, 7))} aria-label="Next week" data-testid="week-next">
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {week !== currentWeek ? (
        <button type="button" className="btn btn-secondary" onClick={() => onWeek(currentWeek)} data-testid="week-current">
          This week
        </button>
      ) : null}
    </div>
  )
}

function HistoryList({ sheet }: { sheet: Sheet }) {
  if (sheet.decisions.length === 0) return null
  return (
    <details className="ts-history" data-testid="sheet-history">
      <summary>Decision history ({sheet.decisions.length})</summary>
      <ol>
        {sheet.decisions.map((d) => (
          <li key={d.decision_id} data-testid="history-item">
            <strong>
              {d.action === 'approve' ? 'Approved' : 'Rejected'} by {d.by.name}
            </strong>{' '}
            <span className="ts-muted">
              (submission {d.submission_no}, {formatDateTimeIn(d.at, sheet.timezone)})
            </span>
            {d.comment ? <div className="ts-prewrap">{d.comment}</div> : null}
          </li>
        ))}
      </ol>
    </details>
  )
}

function StatusBanner({ sheet, own }: { sheet: Sheet; own: boolean }) {
  const approver = sheet.approver.kind === 'manager' ? (sheet.approver.name ?? 'the manager') : 'HR'
  if (sheet.status === 'rejected' && sheet.decision) {
    return (
      <Banner tone="danger" title={`Rejected by ${sheet.decision.by.name}`} testId="status-rejected">
        <span className="ts-prewrap" data-testid="rejection-comment">
          {sheet.decision.comment || 'No reason was given.'}
        </span>
        {own ? <div className="ts-banner-next">Fix the hours and submit again. The earlier decision stays in the history.</div> : null}
      </Banner>
    )
  }
  if (sheet.status === 'submitted') {
    return (
      <Banner tone="info" testId="status-submitted">
        {own ? `Submitted${sheet.submitted_at ? ` ${formatDateTimeIn(sheet.submitted_at, sheet.timezone)}` : ''}. Waiting for ${approver} to review it. You can recall it until it is decided.` : 'Submitted and waiting for a decision.'}
      </Banner>
    )
  }
  if (sheet.status === 'approved') {
    return (
      <Banner tone="success" title={sheet.decision ? `Approved by ${sheet.decision.by.name}` : 'Approved'} testId="status-approved">
        Approval only confirms the hours. It has no effect on pay.
        {sheet.decision?.comment ? <div className="ts-prewrap">{sheet.decision.comment}</div> : null}
      </Banner>
    )
  }
  return null
}

// ------------------------------------------------------------------------------------------------ the sheet itself
interface SheetViewProps {
  sheet: Sheet
  codes: Code[]
  own: boolean
  onSheet: (s: Sheet) => void
  onReload: () => void
  onDirty: (dirty: boolean) => void
}

function SheetBody({ sheet, codes, own, onSheet, onReload, onDirty }: SheetViewProps) {
  const phone = useMediaQuery('(max-width: 640px)')
  const days = sheet.days
  const baseline = useMemo(() => gridFromRows(sheet.rows, days), [sheet.rows, days])
  const [rows, setRows] = useState<GridRow[]>(baseline)
  const [busy, setBusy] = useState<'save' | 'submit' | 'recall' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const guard = useRef(false)

  // New data from the server (week change, save, submit, recall, reload after a conflict): show it.
  useEffect(() => {
    setRows(baseline)
  }, [sheet.sheet_id, sheet.version, sheet.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMessage(null), [sheet.sheet_id])

  const editable = own && sheet.allowed_actions.includes('edit')
  const can = (a: string) => (sheet.allowed_actions as string[]).includes(a)
  const validation = useMemo(() => validateGrid(rows, days), [rows, days])
  const totals = useMemo(() => computeTotals(rows, days), [rows, days])
  const dirty = editable && gridDirty(rows, baseline, days)
  const used = new Set(rows.map((r) => r.code_id))
  const addable = codes.filter((c) => c.active && !used.has(c.code_id))
  const full = rows.length >= (sheet.limits?.max_rows ?? MAX_ROWS)

  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before the tab is closed with unsaved hours.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const onCell = useCallback((codeId: string, day: string, text: string) => {
    setMessage(null)
    setRows((rs) => rs.map((r) => (r.code_id === codeId ? { ...r, cells: { ...r.cells, [day]: text } } : r)))
  }, [])
  const onRemove = useCallback((codeId: string) => {
    setMessage(null)
    setRows((rs) => rs.filter((r) => r.code_id !== codeId))
  }, [])
  const addCode = (codeId: string) => {
    const c = codes.find((x) => x.code_id === codeId)
    if (!c || used.has(c.code_id) || full) return
    setMessage(null)
    setRows((rs) => [...rs, emptyRow(c, days)])
  }

  async function run<T>(kind: 'save' | 'submit' | 'recall', fn: () => Promise<T>, onOk: (v: T) => string | null) {
    if (guard.current) return
    guard.current = true
    setBusy(kind)
    setMessage(null)
    try {
      const v = await fn()
      const text = onOk(v)
      if (text) setMessage({ tone: 'ok', text })
    } catch (e) {
      const p = toProblem(e, kind === 'save' ? 'The timesheet could not be saved.' : kind === 'submit' ? 'The timesheet could not be submitted.' : 'The timesheet could not be recalled.')
      if (p.status === 409 && p.code !== 'not_recallable' && p.code !== 'not_editable') {
        // Stale version: someone (or another tab) changed it. Show the latest and say so.
        onReload()
        setMessage({ tone: 'error', text: 'This timesheet was changed elsewhere. The latest version has been loaded and your unsaved edits were discarded.' })
      } else {
        if (p.status === 409) onReload()
        setMessage({ tone: 'error', text: p.detail })
      }
    } finally {
      guard.current = false
      setBusy(null)
    }
  }

  const save = () => {
    if (!validation.ok) return
    return run('save', () => timesheetApi.saveSheet(sheet.sheet_id, toPayloadRows(rows, days), sheet.version || undefined), (s) => {
      onSheet(s)
      return 'Saved.'
    })
  }

  const submit = () => {
    if (!validation.ok) return
    if (totals.total <= 0) {
      setMessage({ tone: 'error', text: 'Add some hours before submitting.' })
      return
    }
    return run(
      'submit',
      async () => {
        let current = sheet
        if (dirty) current = await timesheetApi.saveSheet(sheet.sheet_id, toPayloadRows(rows, days), sheet.version || undefined)
        else if (!sheet.persisted) current = await timesheetApi.saveSheet(sheet.sheet_id, toPayloadRows(rows, days), undefined)
        try {
          return await timesheetApi.submitSheet(current.sheet_id, current.version)
        } catch (e) {
          onSheet(current) // the save worked even though the submit did not
          throw e
        }
      },
      (s) => {
        onSheet(s)
        return 'Submitted for approval.'
      },
    )
  }

  const recall = () =>
    run('recall', () => timesheetApi.recallSheet(sheet.sheet_id, sheet.version), (s) => {
      onSheet(s)
      return 'Recalled. You can edit it again.'
    })

  async function decide(action: 'approve' | 'reject', comment: string) {
    try {
      onSheet(await timesheetApi.decideSheet(sheet.sheet_id, { action, ...(comment ? { comment } : {}), version: sheet.version }))
    } catch (e) {
      const p = toProblem(e, 'The decision could not be saved.')
      if (p.status === 409) {
        // Decided or changed meanwhile: show the latest (the decision panel disappears) and say why.
        onReload()
        setMessage({ tone: 'error', text: `${p.detail} The latest version is shown.` })
        return
      }
      throw e
    }
  }

  const issueList: { key: string; text: string }[] = []
  for (const r of rows) {
    for (const d of days) {
      const issue = validation.cellIssues[`${r.code_id}|${d}`]
      if (issue) issueList.push({ key: `${r.code_id}${d}`, text: `${r.code_name}, ${formatDayLabel(d)}: ${CELL_MESSAGE[issue]}` })
    }
  }
  for (const d of days) if (validation.dayIssues[d]) issueList.push({ key: `day${d}`, text: validation.dayIssues[d] })

  const showSubmit = own && can('submit') && !sheet.is_future_week
  const hint = !own
    ? null
    : sheet.is_future_week && editable
      ? 'This week has not started. You can save hours now and submit once the week begins.'
      : null

  return (
    <div className="ts-stack" data-testid="sheet" data-status={sheet.status} data-week={sheet.week_start}>
      <section className="card card-pad" aria-labelledby="sheet-title">
        <div className="ts-section-head">
          <div>
            <h2 id="sheet-title" data-testid="sheet-title">
              {own ? 'My timesheet' : `Timesheet of ${sheet.employee.name}`}
            </h2>
            <p className="card-sub">
              Week of {formatWeekRange(sheet.week_start)}. Total <strong data-testid="sheet-total">{formatHours(editable ? totals.total : sheet.total_hours)}</strong> hours.
            </p>
          </div>
          <Pill tone={sheetStatusTone(sheet.status)} testId="sheet-status">
            {sheetStatusLabel(sheet.status)}
          </Pill>
        </div>

        <StatusBanner sheet={sheet} own={own} />
        {hint ? <p className="ts-muted ts-hint" data-testid="future-week-hint">{hint}</p> : null}

        <SheetGrid days={days} rows={rows} editable={editable} phone={phone} validation={validation} totals={totals} onCell={onCell} onRemove={onRemove} />

        {issueList.length > 0 ? (
          <ul className="ts-issues" data-testid="grid-issues" role="alert">
            {issueList.map((i) => (
              <li key={i.key}>{i.text}</li>
            ))}
          </ul>
        ) : null}

        {editable ? (
          <div className="ts-add-row">
            <label className="ts-field ts-add-field">
              <span>Add a code</span>
              <select
                className="ts-input"
                value=""
                onChange={(e) => addCode(e.target.value)}
                disabled={addable.length === 0 || full}
                data-testid="add-code"
              >
                <option value="">{full ? `Row limit reached (${MAX_ROWS})` : addable.length === 0 ? 'All active codes are on the sheet' : 'Choose a code...'}</option>
                {addable.map((c) => (
                  <option key={c.code_id} value={c.code_id}>
                    {c.name}
                    {c.billable ? ' (billable)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {message ? (
          message.tone === 'ok' ? (
            <p className="ts-ok" role="status" data-testid="sheet-message">
              {message.text}
            </p>
          ) : (
            <div className="ts-msg" data-testid="sheet-error">
              <Alert tone="danger">{message.text}</Alert>
            </div>
          )
        ) : null}

        {own && (editable || can('recall') || showSubmit) ? (
          <div className="ts-button-row ts-sheet-actions">
            {editable ? (
              <button type="button" className="btn btn-secondary" onClick={save} disabled={busy !== null || !validation.ok || !dirty} data-testid="sheet-save">
                <Save size={16} aria-hidden="true" /> {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
            ) : null}
            {showSubmit ? (
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy !== null || !validation.ok} data-testid="sheet-submit">
                <Send size={16} aria-hidden="true" /> {busy === 'submit' ? 'Submitting...' : sheet.status === 'rejected' ? 'Submit again' : 'Submit for approval'}
              </button>
            ) : null}
            {can('recall') ? (
              <button type="button" className="btn btn-secondary" onClick={recall} disabled={busy !== null} data-testid="sheet-recall">
                <Undo2 size={16} aria-hidden="true" /> {busy === 'recall' ? 'Recalling...' : 'Recall'}
              </button>
            ) : null}
            {dirty ? (
              <span className="ts-muted" data-testid="unsaved-note">
                Unsaved changes
              </span>
            ) : null}
          </div>
        ) : null}

        <HistoryList sheet={sheet} />
      </section>

      {!own ? <DecisionPanel subject="timesheet" allowed={sheet.allowed_actions} onDecide={decide} /> : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ tab
export function TimesheetTab({ config, codes }: { config: TimesheetConfig; codes: Code[] }) {
  const [params, setParams] = useSearchParams()
  const ownId = useAuthStore((s) => s.user?.employee_id)
  const target = parseTimesheetTarget(params, config.current_week_start, ownId)
  const other = target.employeeId
  const from = params.get('from')
  const [pendingWeek, setPendingWeek] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const sheet = useLoad<Sheet>(
    () => (other ? timesheetApi.sheet(sheetIdFor(other, target.week)) : timesheetApi.mySheet(target.week)),
    [other, target.week],
    'The timesheet could not be loaded.',
  )

  const goWeek = (monday: string) => {
    const p = new URLSearchParams(params)
    p.set('tab', 'timesheet')
    if (monday === config.current_week_start && !other) p.delete('week')
    else p.set('week', monday)
    setParams(p, { replace: true })
    setPendingWeek(null)
  }

  const s = sheet.data

  const backTo = other ? (from === 'team' ? ['?tab=team', 'Back to the team'] : from === 'hr' ? ['?tab=hr', 'Back to the overview'] : ['?tab=approvals', 'Back to approvals']) : null

  return (
    <div className="ts-stack" data-testid="tab-timesheet">
      <div className="ts-toolbar">
        {backTo ? (
          <Link to={backTo[0]} className="btn btn-secondary" data-testid="sheet-back">
            <ChevronLeft size={16} aria-hidden="true" /> {backTo[1]}
          </Link>
        ) : null}
        <WeekNav week={target.week} currentWeek={config.current_week_start} onWeek={(m) => (dirty ? setPendingWeek(m) : goWeek(m))} />
        {other && !s && !sheet.error ? <span className="ts-muted">Opening the timesheet...</span> : null}
      </div>

      {pendingWeek ? (
        <div className="ts-confirm" role="group" aria-label="Unsaved changes" data-testid="discard-confirm-box">
          <span>You have unsaved hours on this week. Leave without saving?</span>
          <button type="button" className="btn ts-btn-danger" onClick={() => goWeek(pendingWeek)} data-testid="discard-confirm">
            Discard and go
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setPendingWeek(null)} data-testid="discard-stay">
            Stay here
          </button>
        </div>
      ) : null}

      {sheet.error && !s ? (
        <ErrorBlock problem={sheet.error} onRetry={sheet.reload} what="This timesheet" />
      ) : !s ? (
        <LoadingCard testId="sheet-loading" lines={5} />
      ) : (
        <SheetBody key={s.sheet_id} sheet={s} codes={codes} own={!other} onSheet={sheet.setData} onReload={sheet.reload} onDirty={setDirty} />
      )}
    </div>
  )
}
