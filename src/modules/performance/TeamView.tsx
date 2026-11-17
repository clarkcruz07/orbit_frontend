import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Send, Users } from 'lucide-react'
import { directoryApi, type DirectReport } from '@/api/directory'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { performanceApi, type Checkin, type Goal, type Page } from './api'
import { useDebounced, useLoad } from './hooks'
import { CheckinRows, GoalRows } from './lists'
import { ErrorBlock, FieldError, LoadingCard, Pager, Tabs } from './parts'
import {
  CHECKIN_STATUSES,
  DEFAULT_LIMITS,
  GOAL_STATUSES,
  TEAM_SCOPE_LABEL,
  TEAM_VIEWS,
  TEAM_VIEW_LABEL,
  checkinStatusLabel,
  goalStatusLabel,
  parseServerError,
  parseTeamView,
  teamScopes,
  validatePeriod,
  type TeamScope,
  type TeamView as TeamViewId,
} from './logic'

const PAGE_SIZE = 20

export function TeamView({ reviewsWaiting, limits = DEFAULT_LIMITS, onChanged }: { reviewsWaiting?: number; limits?: typeof DEFAULT_LIMITS; onChanged?: () => void }) {
  const roles = useAuthStore((s) => s.user?.roles)
  const scopes = useMemo(() => teamScopes(roles), [roles])
  const [params, setParams] = useSearchParams()
  const view = parseTeamView(params.get('view'))
  const wantedScope = params.get('scope')
  const scope: TeamScope = (scopes.find((s) => s === wantedScope) ?? scopes[0] ?? 'team') as TeamScope
  const canRequest = scopes.includes('team')

  const [status, setStatus] = useState('')
  const [periodText, setPeriodText] = useState('')
  const period = useDebounced(periodText, 300)
  const [employee, setEmployee] = useState('')
  const [page, setPage] = useState(1)
  const [flash, setFlash] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const people = useRef(new Map<string, string>())

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const resetFilters = () => {
    setStatus('')
    setPeriodText('')
    setEmployee('')
    setPage(1)
  }

  const reviewList = useLoad<Page<Checkin>>(
    () => performanceApi.checkins({ scope: 'review', page: view === 'review' ? page : 1, page_size: PAGE_SIZE }).then((r) => r.data),
    [view === 'review' ? page : 1],
    'The check-ins waiting for you could not be loaded.',
  )
  const checkins = useLoad<Page<Checkin> | null>(
    () => (view === 'checkins' ? performanceApi.checkins({ scope, status, period, employee_id: employee, page, page_size: PAGE_SIZE }).then((r) => r.data) : Promise.resolve(null)),
    [view, scope, status, period, employee, page],
    'The team check-ins could not be loaded.',
  )
  const goals = useLoad<Page<Goal> | null>(
    () => (view === 'goals' ? performanceApi.goals({ scope, status, employee_id: employee, page, page_size: PAGE_SIZE }).then((r) => r.data) : Promise.resolve(null)),
    [view, scope, status, employee, page],
    'The team goals could not be loaded.',
  )

  // Remember who has been seen so the employee filter can offer them (a filter never widens the scope).
  for (const x of [...(checkins.data?.items ?? []), ...(goals.data?.items ?? []), ...(reviewList.data?.items ?? [])]) {
    people.current.set(x.employee.employee_id, x.employee.name ?? x.employee.employee_id)
  }
  const peopleOptions = [...people.current.entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const waiting = reviewList.data?.total ?? reviewsWaiting ?? 0

  return (
    <section aria-labelledby="team-title" data-testid="team-view">
      <div className="pf-toolbar">
        <h2 id="team-title" className="pf-section-title">
          Team
        </h2>
        <div className="pf-toolbar-right">
          {scopes.length > 1 ? (
            <label className="pf-filter">
              <span className="pf-visually-hidden">Whose records</span>
              <select
                className="pf-input pf-select"
                value={scope}
                onChange={(e) => {
                  set('scope', e.target.value === scopes[0] ? null : e.target.value)
                  resetFilters()
                }}
                aria-label="Whose records"
                data-testid="team-scope"
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {TEAM_SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canRequest && !requesting ? (
            <button type="button" className="btn btn-primary" onClick={() => setRequesting(true)} data-testid="request-checkin">
              <Send size={16} aria-hidden="true" /> Request a check-in
            </button>
          ) : null}
        </div>
      </div>
      {scope === 'all' ? <p className="pf-help" data-testid="team-readonly-note">Oversight is read-only. You can only acknowledge check-ins from people who have no manager to review them.</p> : null}

      {flash ? (
        <p className="pf-flash" role="status" data-testid="team-flash">
          {flash}
        </p>
      ) : null}

      {requesting ? (
        <RequestCheckin
          limits={limits}
          onCancel={() => setRequesting(false)}
          onDone={(c) => {
            setRequesting(false)
            setFlash(`Check-in requested from ${c.employee.name ?? c.employee.employee_id}: ${c.period_label}`)
            checkins.reload()
            onChanged?.()
          }}
        />
      ) : null}

      <Tabs
        tabs={TEAM_VIEWS.map((v) => ({ id: v, label: TEAM_VIEW_LABEL[v], badge: v === 'review' ? waiting : null }))}
        active={view}
        onSelect={(v: TeamViewId) => {
          set('view', v === 'review' ? null : v)
          resetFilters()
        }}
        label="Team lists"
        testPrefix="team-view"
      />

      {view !== 'review' ? (
        <div className="pf-filters" data-testid="team-filters">
          <label className="pf-filter-field">
            <span className="pf-label">Status</span>
            <select
              className="pf-input pf-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
              data-testid="team-status-filter"
            >
              <option value="">All statuses</option>
              {(view === 'goals' ? GOAL_STATUSES : CHECKIN_STATUSES).map((s) => (
                <option key={s} value={s}>
                  {view === 'goals' ? goalStatusLabel(s) : checkinStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {view === 'checkins' ? (
            <label className="pf-filter-field">
              <span className="pf-label">Period (exact name)</span>
              <input
                className="pf-input"
                value={periodText}
                onChange={(e) => {
                  setPeriodText(e.target.value)
                  setPage(1)
                }}
                placeholder="e.g. 2027-Q1"
                data-testid="team-period-filter"
                autoComplete="off"
              />
            </label>
          ) : null}
          <label className="pf-filter-field">
            <span className="pf-label">Person</span>
            <select
              className="pf-input pf-select"
              value={employee}
              onChange={(e) => {
                setEmployee(e.target.value)
                setPage(1)
              }}
              data-testid="team-person-filter"
            >
              <option value="">Everyone in this list</option>
              {peopleOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {view === 'review' ? (
        <ListBlock<Checkin>
          state={reviewList}
          emptyTitle="Nothing is waiting for you"
          emptyBody="Submitted check-ins you can acknowledge appear here."
          icon={<CheckCircle2 size={28} />}
          render={(items) => <CheckinRows items={items} showOwner />}
          page={page}
          setPage={setPage}
        />
      ) : view === 'checkins' ? (
        <ListBlock<Checkin>
          state={checkins}
          emptyTitle={status || period || employee ? 'No check-ins match these filters' : 'No check-ins to show'}
          emptyBody={status || period || employee ? 'Try clearing a filter.' : 'Check-ins from the people you can see appear here.'}
          icon={<Users size={28} />}
          render={(items) => <CheckinRows items={items} showOwner />}
          page={page}
          setPage={setPage}
        />
      ) : (
        <ListBlock<Goal>
          state={goals}
          emptyTitle={status || employee ? 'No goals match these filters' : 'No goals to show'}
          emptyBody={status || employee ? 'Try clearing a filter.' : 'Goals from the people you can see appear here. Open one to read it or leave a comment.'}
          icon={<Users size={28} />}
          render={(items) => <GoalRows goals={items} showOwner />}
          page={page}
          setPage={setPage}
        />
      )}
    </section>
  )
}

function ListBlock<T>({
  state,
  emptyTitle,
  emptyBody,
  icon,
  render,
  page,
  setPage,
}: {
  state: { data: Page<T> | null; error: { detail: string } | null; loading: boolean; reload: () => void }
  emptyTitle: string
  emptyBody: string
  icon: JSX.Element
  render: (items: T[]) => JSX.Element
  page: number
  setPage: (n: number) => void
}) {
  const d = state.data
  if (state.error) return <ErrorBlock message={state.error.detail} onRetry={state.reload} />
  if (!d) return <LoadingCard />
  if (d.items.length === 0) return <EmptyState icon={icon} title={emptyTitle} body={emptyBody} />
  return (
    <>
      {render(d.items)}
      <Pager page={d.page || page} total={d.total} pageSize={d.page_size} onPage={setPage} />
    </>
  )
}

function RequestCheckin({ limits, onCancel, onDone }: { limits: typeof DEFAULT_LIMITS; onCancel: () => void; onDone: (c: Checkin) => void }) {
  const me = useAuthStore((s) => s.user?.employee_id ?? null)
  const reports = useLoad<DirectReport[]>(() => (me ? directoryApi.get(me).then((p) => p.direct_reports) : Promise.resolve([])), [me], 'Your direct reports could not be loaded.')
  const [who, setWho] = useState('')
  const [period, setPeriod] = useState('')
  const [errors, setErrors] = useState<{ who?: string; period?: string }>({})
  const [serverError, setServerError] = useState<{ detail: string; existing: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const first = reports.data?.[0]
    if (first && !who) setWho(first.employee_id)
  }, [reports.data, who])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const found: { who?: string; period?: string } = {}
    if (!who) found.who = 'Choose who to ask.'
    const pe = validatePeriod(period, limits)
    if (pe) found.period = pe
    setErrors(found)
    setServerError(null)
    if (found.who || found.period) return
    setBusy(true)
    try {
      const res = await performanceApi.requestCheckin(who, period.trim())
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The check-in could not be requested.')
      setServerError({ detail: info.detail, existing: info.existingCheckinId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad pf-form-card" data-testid="request-card">
      <h3 className="pf-card-title">Request a check-in</h3>
      {reports.error ? (
        <ErrorBlock message={reports.error.detail} onRetry={reports.reload} />
      ) : reports.loading ? (
        <LoadingCard rows={1} />
      ) : (reports.data ?? []).length === 0 ? (
        <>
          <p className="pf-help" data-testid="no-reports">
            You have no direct reports on record, so there is nobody to ask.
          </p>
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} data-testid="request-cancel">
              Close
            </button>
          </div>
        </>
      ) : (
        <form className="pf-form" onSubmit={submit} noValidate>
          <div className="pf-field">
            <label htmlFor="request-who" className="pf-label">
              Ask
            </label>
            <select id="request-who" className="pf-input pf-select" value={who} onChange={(e) => setWho(e.target.value)} data-testid="request-who" aria-invalid={errors.who ? true : undefined}>
              {(reports.data ?? []).map((r) => (
                <option key={r.employee_id} value={r.employee_id}>
                  {r.name}
                  {r.job_title ? ` - ${r.job_title}` : ''}
                </option>
              ))}
            </select>
            <FieldError id="request-who-error" message={errors.who} />
          </div>
          <div className="pf-field pf-field-narrow">
            <label htmlFor="request-period" className="pf-label">
              Period
            </label>
            <input
              id="request-period"
              className="pf-input"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="e.g. 2027-Q1 or Week 12"
              maxLength={limits.period_label_max + 20}
              aria-invalid={errors.period ? true : undefined}
              aria-describedby={errors.period ? 'request-period-error' : undefined}
              data-testid="request-period"
              autoComplete="off"
            />
            <FieldError id="request-period-error" message={errors.period} />
          </div>
          {serverError ? (
            <div data-testid="request-error">
              <Alert tone="danger">
                {serverError.detail}
                {serverError.existing ? (
                  <>
                    {' '}
                    <Link to={`/performance/checkins/${encodeURIComponent(serverError.existing)}`} className="pf-inline-link">
                      Open the existing check-in
                    </Link>
                  </>
                ) : null}
              </Alert>
            </div>
          ) : null}
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="request-cancel">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="request-submit">
              {busy ? 'Sending...' : 'Send request'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
