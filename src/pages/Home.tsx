import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, CircleCheck, ClipboardCheck, Hourglass, Plus, Receipt } from 'lucide-react'
import { calendarApi, type CalendarEvent, type CalendarUpcoming } from '@/api/calendar'
import { reimbursementsApi, type ReimbursementSummary, type Scope } from '@/api/reimbursements'
import { birthdayChip, type BlockState, type DashboardModel } from '@/lib/dashboardFormat'
import { DashboardClock } from '@/modules/timesheet/DashboardClock'
import { useAuthStore } from '@/stores/authStore'
import { EmptyState } from '@/ui/EmptyState'
import { Alert, Skeleton } from '@/ui/Feedback'
import { CardHeader, HrSwoosh, Pill, SummaryCard, UpcomingCard } from './hr/parts'
import { StatusPill } from './reimbursements/parts'
import { STATUS_ORDER, availableScopes, countByStatus, formatDate, formatMoney, parseServerError, statusLabel } from './reimbursements/logic'
import './pages.css'
import './hr/hr-admin.css'
import './reimbursements/reimbursements.css'

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; items: ReimbursementSummary[] }

function useScopeList(scope: Scope, enabled: boolean): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const run = useCallback(() => {
    if (!enabled) return () => undefined
    let live = true
    setLoad({ state: 'loading' })
    reimbursementsApi
      .list(scope)
      .then((r) => live && setLoad({ state: 'ready', items: r.data }))
      .catch((e) => live && setLoad({ state: 'error', message: parseServerError(e, 'This could not be loaded.').detail }))
    return () => {
      live = false
    }
  }, [scope, enabled])
  useEffect(() => run(), [run])
  return [load, run]
}

type UpcomingLoad = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: CalendarUpcoming }

function useUpcoming(): [UpcomingLoad, () => void] {
  const [load, setLoad] = useState<UpcomingLoad>({ kind: 'loading' })
  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    calendarApi
      .upcoming(30)
      .then((data) => live && setLoad({ kind: 'ready', data }))
      .catch((e: { response?: { status?: number } }) => live && setLoad({ kind: 'error', message: e?.response?.status ? 'Upcoming dates could not be loaded.' : "Can't reach the Bluedge People service." }))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => run(), [run])
  return [load, run]
}

/** Calendar events -> the shapes the shared "Upcoming Holidays & Birthdays" panel draws. */
function toHolidays(events: CalendarEvent[]): DashboardModel['holidays'] {
  return events.map((e) => {
    const [, m, d] = e.date.split('-')
    return { month: Number(m), day: Number(d), name: e.title, type: e.subtitle ?? 'Holiday' }
  })
}

function toBirthdays(events: CalendarEvent[]): DashboardModel['birthdays'] {
  return events.map((e) => ({ name: e.own ? `${e.title} (you)` : e.title, team: e.subtitle ?? 'Birthday', date: e.date.slice(5), avatar_initials: '' }))
}

function LatestList({ items, showEmployee }: { items: ReimbursementSummary[]; showEmployee?: boolean }) {
  return (
    <ul className="home-latest" data-testid="home-latest">
      {items.map((it) => (
        <li key={it.request_id}>
          <Link to={`/reimbursements/${it.request_id}`} className="home-latest-row" data-testid="home-item">
            <span className="home-latest-main">
              <strong>{it.purpose}</strong>
              <span className="r-sub">
                {showEmployee ? `${it.employee_name ?? 'Unknown'} - ` : ''}
                {it.merchant ? `${it.merchant} - ` : ''}
                {it.total_amount ? formatMoney(it.currency, it.total_amount) : formatDate(it.receipt_date)}
              </span>
            </span>
            <StatusPill status={it.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="home-card-error">
      <Alert tone="danger">{message}</Alert>
      <button type="button" className="btn btn-secondary r-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function CardLoading() {
  return (
    <div aria-busy="true" data-testid="home-card-loading">
      <Skeleton style={{ height: 14, width: '80%', marginTop: 16, marginBottom: 10 }} />
      <Skeleton style={{ height: 14, width: '60%' }} />
    </div>
  )
}

/** The summary card's availability for a list that is loading or failed: numbers only once it is ready. */
const na = (load: Load): BlockState => (load.state === 'error' ? { available: false, reason: 'This could not be loaded just now (temporarily unavailable).' } : { available: true, reason: null })

/** Personal dashboard (non-HR personnel): same look as the HR dashboard, with only the blocks a person may see. */
export function Home() {
  const user = useAuthStore((s) => s.user)
  const first = (user?.name ?? '').split(/\s+/)[0] || 'there'
  const scopes = useMemo(() => availableScopes(user?.roles), [user?.roles])
  const canReview = scopes.includes('review')
  const [mine, reloadMine] = useScopeList('mine', true)
  const [review, reloadReview] = useScopeList('review', canReview)
  const [upcoming, reloadUpcoming] = useUpcoming()

  const counts = mine.state === 'ready' ? countByStatus(mine.items) : null
  const inProgress = counts ? counts.draft + counts.clarification_requested + counts.pending_manager + counts.pending_finance : null
  const nextHoliday = upcoming.kind === 'ready' ? upcoming.data.holidays[0] ?? null : null
  const value = (n: number | null | undefined) => (n === null || n === undefined ? '-' : String(n))

  const upcomingNotice: ReactNode =
    upcoming.kind === 'loading' ? (
      <div aria-busy="true" data-testid="upcoming-loading">
        <Skeleton style={{ height: 14, width: '80%', marginTop: 16, marginBottom: 10 }} />
        <Skeleton style={{ height: 14, width: '60%' }} />
      </div>
    ) : upcoming.kind === 'error' ? (
      <div data-testid="upcoming-error">
        <Alert tone="danger">{upcoming.message}</Alert>
        <button type="button" className="btn btn-secondary r-retry" onClick={reloadUpcoming}>
          Try again
        </button>
      </div>
    ) : null

  return (
    <div className="hr-page home-page">
      <HrSwoosh />
      <div className="hr-title-block">
        <div className="hr-eyebrow-row">
          <span className="hr-eyebrow">BLUEDGE PEOPLE</span>
        </div>
        <h1>{`Welcome, ${first}`}</h1>
        <p>Your personal home in Bluedge People.</p>
      </div>

      <DashboardClock />

      <div className={`summary-row summary-row-${canReview ? 5 : 4}`} data-testid="summary-cards">
        <SummaryCard icon={Receipt} tint="blue" title="My Requests" value={value(mine.state === 'ready' ? mine.items.length : null)} testId="home-sum-total" na={na(mine)}>
          <Pill tone="lavender">Reimbursements</Pill>
        </SummaryCard>
        <SummaryCard icon={Hourglass} tint="lavender" title="In Progress" value={value(inProgress)} testId="home-sum-progress" na={na(mine)}>
          <Pill tone="blue">Not decided yet</Pill>
        </SummaryCard>
        <SummaryCard icon={CircleCheck} tint="blue" title="Approved" value={value(counts?.approved)} testId="home-sum-approved" na={na(mine)}>
          <Pill tone="lavender">Approved so far</Pill>
        </SummaryCard>
        {canReview ? (
          <SummaryCard icon={ClipboardCheck} tint="lavender" title="Awaiting My Review" value={value(review.state === 'ready' ? review.items.length : null)} testId="home-sum-review" na={na(review)}>
            <Pill tone="amber">Needs your decision</Pill>
          </SummaryCard>
        ) : null}
        <SummaryCard
          icon={CalendarDays}
          tint={canReview ? 'blue' : 'lavender'}
          title="Next Holiday"
          value={nextHoliday ? birthdayChip(nextHoliday.date.slice(5)) : '-'}
          testId="home-sum-holiday"
          na={{ available: upcoming.kind !== 'error', reason: upcoming.kind === 'error' ? 'This could not be loaded just now (temporarily unavailable).' : null }}
        >
          <Pill tone="amber">{nextHoliday ? nextHoliday.title : upcoming.kind === 'ready' ? 'None in 30 days' : 'Loading'}</Pill>
        </SummaryCard>
      </div>

      <div className="hr-grid">
        <div className="hr-left">
          <section className="hr-card hr-wide" aria-labelledby="home-mine" data-testid="home-my-reimbursements">
            <CardHeader icon={Receipt} title="My reimbursements" subtitle="Requests you have submitted and their progress" action="View my requests" actionTo="/reimbursements" id="home-mine" />
            {mine.state === 'loading' ? (
              <CardLoading />
            ) : mine.state === 'error' ? (
              <CardError message={mine.message} onRetry={reloadMine} />
            ) : mine.items.length === 0 ? (
              <EmptyState
                plain
                icon={<Receipt size={24} />}
                title="No reimbursements yet"
                body="When you submit a receipt for reimbursement it will show up here."
                action={
                  <Link to="/reimbursements/new" className="btn btn-primary" data-testid="home-new">
                    <Plus size={16} aria-hidden="true" /> New reimbursement
                  </Link>
                }
              />
            ) : (
              <>
                <ul className="home-counts" data-testid="home-counts">
                  {STATUS_ORDER.map((s) => {
                    const n = countByStatus(mine.items)[s]
                    return (
                      <li key={s} className={n === 0 ? 'zero' : undefined} data-status={s} data-count={n}>
                        <span className="home-count-n">{n}</span>
                        <span className="home-count-l">{statusLabel(s)}</span>
                      </li>
                    )
                  })}
                </ul>
                <LatestList items={mine.items.slice(0, 3)} />
                <div className="home-card-links">
                  <Link to="/reimbursements" className="request-card-open" data-testid="home-view-mine">
                    View my requests <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <Link to="/reimbursements/new" className="request-card-open">
                    <Plus size={16} aria-hidden="true" /> New reimbursement
                  </Link>
                </div>
              </>
            )}
          </section>

          {canReview ? (
            <section className="hr-card hr-wide" aria-labelledby="home-review" data-testid="home-awaiting-review">
              <CardHeader icon={ClipboardCheck} title="Awaiting my review" subtitle="Requests that need your decision" action="Open review list" actionTo="/reimbursements?tab=review" id="home-review" />
              {review.state === 'loading' ? (
                <CardLoading />
              ) : review.state === 'error' ? (
                <CardError message={review.message} onRetry={reloadReview} />
              ) : review.items.length === 0 ? (
                <EmptyState plain icon={<ClipboardCheck size={24} />} title="Nothing is waiting for you" body="Requests that need your decision will appear here." />
              ) : (
                <>
                  <p className="home-review-count" data-testid="home-review-count" data-count={review.items.length}>
                    <span className="home-count-n">{review.items.length}</span>
                    <span>{review.items.length === 1 ? 'request is waiting for your decision' : 'requests are waiting for your decision'}</span>
                  </p>
                  <LatestList items={review.items.slice(0, 3)} showEmployee />
                  <div className="home-card-links">
                    <Link to="/reimbursements?tab=review" className="request-card-open" data-testid="home-view-review">
                      Open review list <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>

        <div data-testid="home-upcoming">
          <UpcomingCard
            birthdays={upcoming.kind === 'ready' ? toBirthdays(upcoming.data.birthdays) : []}
            holidays={upcoming.kind === 'ready' ? toHolidays(upcoming.data.holidays) : []}
            failed={[]}
            notice={upcomingNotice}
          />
        </div>
      </div>
    </div>
  )
}
