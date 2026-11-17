import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Plus, Scale } from 'lucide-react'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi, type BalancesResponse } from './api'
import { balanceView, formatDays, formatNumber, friendlyError, parseLeaveError } from './logic'
import { Pill, useLeaveTypes } from './parts'
import { RequestsPanel } from './RequestsPanel'

type Load = { kind: 'loading' } | { kind: 'ready'; data: BalancesResponse } | { kind: 'error'; message: string }

function yearOptions(current: number): number[] {
  return [current + 1, current, current - 1, current - 2]
}

function BalanceCards({ year }: { year: number }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    leaveApi
      .balances(year)
      .then((data) => live && setLoad({ kind: 'ready', data }))
      .catch((e) => live && setLoad({ kind: 'error', message: friendlyError(parseLeaveError(e, 'Your balances could not be loaded.')) }))
    return () => {
      live = false
    }
  }, [year])
  useEffect(() => run(), [run])

  if (load.kind === 'error')
    return (
      <div data-testid="balances-error">
        <Alert tone="danger">{load.message}</Alert>
        <button type="button" className="btn btn-secondary lv-retry" onClick={() => run()}>
          Try again
        </button>
      </div>
    )
  if (load.kind === 'loading')
    return (
      <div className="lv-balance-grid" aria-busy="true" data-testid="balances-loading">
        <span className="sr-only" role="status">
          Loading your balances
        </span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card card-pad">
            <Skeleton style={{ height: 16, width: '50%', marginBottom: 12 }} />
            <Skeleton style={{ height: 34, width: '40%', marginBottom: 12 }} />
            <Skeleton style={{ height: 8 }} />
          </div>
        ))}
      </div>
    )
  if (load.data.items.length === 0)
    return <EmptyState icon={<Scale size={28} />} title="No leave types are set up" body="HR has not set up any leave types yet." />

  return (
    <div className="lv-balance-grid" data-testid="balance-cards" data-year={load.data.year}>
      {load.data.items.map((b) => {
        const v = balanceView(b)
        const negative = b.remaining !== null && b.remaining < 0
        return (
          <article key={b.type_id} className={`card lv-balance${negative ? ' lv-balance-over' : ''}`} data-testid="balance-card" data-type={b.type_id}>
            <header className="lv-balance-head">
              <h3 className="lv-wrap">{b.name}</h3>
              {!b.active ? <Pill tone="neutral">No longer available</Pill> : null}
              {b.override ? <Pill tone="violet" title="HR set a different entitlement for you for this year.">Set by HR for you</Pill> : null}
            </header>
            <p className="lv-balance-remaining" data-testid="balance-remaining">
              <span className="lv-balance-number">{b.unlimited || b.remaining === null ? 'No limit' : formatNumber(b.remaining)}</span>
              {b.unlimited || b.remaining === null ? null : <span className="lv-balance-unit">{Math.abs(b.remaining) === 1 ? 'day' : 'days'} remaining</span>}
            </p>
            {b.unlimited ? (
              <p className="lv-sub">Unpaid leave has no balance limit.</p>
            ) : (
              <div className="lv-bar" role="img" aria-label={`${formatDays(b.used)} used and ${formatDays(b.pending)} pending of ${formatDays(b.entitlement)}`}>
                <span className="lv-bar-used" style={{ width: `${v.usedPct}%` }} />
                <span className="lv-bar-pending" style={{ width: `${v.pendingPct}%` }} />
              </div>
            )}
            <dl className="lv-stats">
              {b.unlimited ? null : (
                <div>
                  <dt>Entitlement</dt>
                  <dd data-testid="balance-entitlement">{formatNumber(b.entitlement)}</dd>
                </div>
              )}
              <div>
                <dt>Used</dt>
                <dd data-testid="balance-used">{formatNumber(b.used)}</dd>
              </div>
              <div>
                <dt>Pending</dt>
                <dd data-testid="balance-pending">{formatNumber(b.pending)}</dd>
              </div>
              {b.unlimited ? null : (
                <div>
                  <dt>Remaining</dt>
                  <dd>{formatNumber(b.remaining)}</dd>
                </div>
              )}
            </dl>
          </article>
        )
      })}
    </div>
  )
}

/** "My leave": balances for one year, then the person's own requests. */
export function MyLeaveTab({ currentYear }: { currentYear: number }) {
  const [params, setParams] = useSearchParams()
  const years = useMemo(() => yearOptions(currentYear), [currentYear])
  const byRaw = Number(params.get('by'))
  const balanceYear = years.includes(byRaw) ? byRaw : currentYear
  const { types } = useLeaveTypes()

  function setBalanceYear(y: number) {
    const p = new URLSearchParams(params)
    if (y === currentYear) p.delete('by')
    else p.set('by', String(y))
    setParams(p, { replace: true })
  }

  const newLink = (
    <Link to="/leave/new" className="btn btn-primary" data-testid="leave-new-empty">
      <Plus size={16} aria-hidden="true" /> New leave request
    </Link>
  )

  return (
    <div data-testid="tab-panel-my">
      <section aria-labelledby="lv-balances-h" className="lv-section">
        <div className="lv-section-head">
          <h2 id="lv-balances-h">Balances</h2>
          <label className="lv-filter lv-filter-inline">
            <span className="lv-filter-label">Year</span>
            <select className="lv-input" value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value))} data-testid="balance-year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        <BalanceCards year={balanceYear} />
      </section>

      <section aria-labelledby="lv-mine-h" className="lv-section">
        <div className="lv-section-head">
          <h2 id="lv-mine-h">My requests</h2>
        </div>
        <RequestsPanel
          scope="mine"
          showEmployee={false}
          types={types}
          years={years}
          allowStatusFilter
          emptyTitle="No leave requests yet"
          emptyBody="When you ask for time off it will be listed here, with its status."
          newLink={newLink}
        />
      </section>
    </div>
  )
}
