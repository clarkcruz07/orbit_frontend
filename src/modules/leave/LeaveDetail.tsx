import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, FileX } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi, type LeaveRequest } from './api'
import { CancelPanel, DecisionPanel, EditPanel, Timeline } from './DetailPanels'
import {
  approverLine,
  daysByYearText,
  formatDateTime,
  formatDays,
  formatLongDate,
  halfDayLabel,
  hasAction,
  isDeciderMode,
  isEditorMode,
  parseLeaveError,
} from './logic'
import { Pill, Spinner, StatusPill, useLeaveConfig, useLeaveTypes } from './parts'
import '@/pages/pages.css'
import './leave.css'

type LoadState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready' }

/** `leave/:id`: dates, type, status, approver, history and the actions the server allows for this person. */
export function LeaveDetail() {
  const { id = '' } = useParams()
  const location = useLocation()
  const myEmployeeId = useAuthStore((s) => s.user?.employee_id ?? null)
  const { config, today } = useLeaveConfig()
  const { types } = useLeaveTypes()
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [req, setReq] = useState<LeaveRequest | null>(null)
  const [flash, setFlash] = useState<string | null>(() => ((location.state as { flash?: string } | null)?.flash === 'created' ? 'Leave request sent. Your approver has been notified.' : null))
  const [conflict, setConflict] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<LeaveRequest | null> => {
    try {
      const r = await leaveApi.get(id)
      setReq(r)
      setLoad({ kind: 'ready' })
      return r
    } catch (err) {
      const info = parseLeaveError(err, 'The leave request could not be loaded.')
      // 404 is the same answer for "does not exist" and "you may not see it": say exactly that, nothing more.
      setLoad(info.status === 404 ? { kind: 'missing' } : { kind: 'error', message: info.detail })
      return null
    }
  }, [id])

  useEffect(() => {
    setLoad({ kind: 'loading' })
    setReq(null)
    setConflict(null)
    void reload()
  }, [reload])

  // Router state lives in history: clear it so a refresh does not repeat the banner.
  useEffect(() => {
    if ((location.state as { flash?: string } | null)?.flash) window.history.replaceState({ ...(window.history.state ?? {}), usr: null }, '')
  }, [location.state])

  function updated(r: LeaveRequest, message: string) {
    setReq(r)
    setConflict(null)
    setFlash(message)
  }
  async function stale(message: string) {
    setFlash(null)
    await reload()
    setConflict(`${message} We reloaded the latest version of this request.`)
  }

  const ctx = useMemo(
    () => ({ types: types ?? [], today, windowDays: config?.window_days, maxSpan: config?.max_span_days, reasonMax: config?.reason_max_chars }),
    [types, today, config],
  )

  const mine = req ? req.employee_id === myEmployeeId : true
  const backTo = mine ? '/leave' : '/leave?tab=approvals'
  const decider = req ? isDeciderMode(req.allowed_actions) : false
  const editor = req ? isEditorMode(req.allowed_actions) : false
  const canCancel = req ? hasAction(req.allowed_actions, 'cancel') : false
  const noActions = req ? !decider && !editor && !canCancel : false

  return (
    <div className="page lv-page" data-testid="leave-detail-page">
      <p className="lv-back">
        <Link to={backTo} className="lv-back-link" data-testid="leave-back">
          <ArrowLeft size={16} aria-hidden="true" /> {mine ? 'Back to leave' : 'Back to approvals'}
        </Link>
      </p>

      {load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="detail-loading">
          <span className="sr-only" role="status">
            Loading the leave request
          </span>
          <Skeleton style={{ height: 26, width: '45%', marginBottom: 14 }} />
          <Skeleton style={{ height: 14, width: '90%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '70%' }} />
        </div>
      ) : load.kind === 'missing' ? (
        <div data-testid="leave-missing">
          <EmptyState
            icon={<FileX size={28} />}
            title="Leave request not found"
            body="This request does not exist, or you do not have access to it."
            action={
              <Link to="/leave" className="btn btn-primary">
                Back to leave
              </Link>
            }
          />
        </div>
      ) : load.kind === 'error' ? (
        <div data-testid="detail-error">
          <Alert tone="danger">{load.message}</Alert>
          <button
            type="button"
            className="btn btn-secondary lv-retry"
            onClick={() => {
              setLoad({ kind: 'loading' })
              void reload()
            }}
          >
            Try again
          </button>
        </div>
      ) : req ? (
        <div data-testid="leave-detail" data-status={req.status} data-id={req.request_id} data-mode={decider ? 'decider' : editor ? 'editor' : 'readonly'}>
          <div className="lv-detail-head">
            <div>
              <h1 className="lv-detail-title" data-testid="detail-title">
                {req.type_name} leave
              </h1>
              <p className="lv-detail-meta" data-testid="detail-dates">
                {req.employee?.name && !mine ? `${req.employee.name} - ` : ''}
                {req.start_date === req.end_date ? formatLongDate(req.start_date) : `${formatLongDate(req.start_date)} to ${formatLongDate(req.end_date)}`}
              </p>
            </div>
            <StatusPill status={req.status} />
          </div>


          {flash ? (
            <div className="lv-flash" data-testid="leave-flash">
              <Alert tone="info">{flash}</Alert>
            </div>
          ) : null}
          {conflict ? (
            <div className="lv-flash" data-testid="conflict-banner">
              <Alert tone="warning">{conflict}</Alert>
            </div>
          ) : null}

          <div className="lv-detail-grid">
            <div className="lv-main">
              <section className="card card-pad lv-section-card" aria-labelledby="lv-summary-h" data-testid="leave-summary">
                <h2 id="lv-summary-h">Request</h2>
                <dl className="lv-facts">
                  <div>
                    <dt>Employee</dt>
                    <dd data-testid="fact-employee">
                      <span className="lv-wrap">{req.employee?.name ?? 'Unknown'}</span>
                      {req.employee?.job_title || req.employee?.department ? <span className="lv-sub">{[req.employee.job_title, req.employee.department].filter(Boolean).join(' - ')}</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Leave type</dt>
                    <dd data-testid="fact-type">
                      {req.type_name} <Pill tone="neutral">{req.paid ? 'Paid' : 'Unpaid'}</Pill>
                    </dd>
                  </div>
                  <div>
                    <dt>Dates</dt>
                    <dd data-testid="fact-dates">
                      {req.start_date === req.end_date ? formatLongDate(req.start_date) : `${formatLongDate(req.start_date)} to ${formatLongDate(req.end_date)}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Days</dt>
                    <dd data-testid="fact-days">
                      {formatDays(req.days)}
                      {req.half_day !== 'none' ? <span className="lv-sub">{halfDayLabel(req.half_day)}</span> : null}
                      {daysByYearText(req.days_by_year) ? <span className="lv-sub">{daysByYearText(req.days_by_year)}</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd data-testid="fact-status">
                      <StatusPill status={req.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Approver</dt>
                    <dd data-testid="fact-approver">{approverLine(req)}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>{formatDateTime(req.created_at)}</dd>
                  </div>
                  {req.decided_at ? (
                    <div>
                      <dt>Decided</dt>
                      <dd>{formatDateTime(req.decided_at)}</dd>
                    </div>
                  ) : null}
                </dl>
                {req.reason ? (
                  <div className="lv-reason" data-testid="fact-reason">
                    <h3>Reason</h3>
                    <p>{req.reason}</p>
                  </div>
                ) : null}
              </section>
              <Timeline req={req} />
            </div>

            <div className="lv-side">
              {decider ? <DecisionPanel key={`${req.request_id}-${req.version}`} req={req} onUpdated={updated} onStale={(m) => void stale(m)} /> : null}
              {editor ? (
                types === null ? (
                  <section className="card card-pad lv-section-card" data-testid="edit-loading">
                    <Spinner label="Loading the form..." />
                  </section>
                ) : (
                  <EditPanel key={`${req.request_id}-${req.version}`} req={req} types={types} ctx={ctx} onUpdated={updated} onStale={(m) => void stale(m)} />
                )
              ) : null}
              {canCancel ? <CancelPanel key={`c-${req.request_id}-${req.version}`} req={req} onUpdated={updated} onStale={(m) => void stale(m)} /> : null}
              {noActions ? (
                <section className="card card-pad lv-section-card" data-testid="no-actions">
                  <h2>Actions</h2>
                  <p className="lv-muted">{mine ? 'No actions are available on this request.' : 'You can view this request. No actions are available to you on it.'}</p>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
