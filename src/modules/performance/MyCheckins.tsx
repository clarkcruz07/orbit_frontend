import { useState } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { performanceApi } from './api'
import { CheckinForm } from './CheckinForm'
import { useLoad } from './hooks'
import { CheckinRows } from './lists'
import { ErrorBlock, LoadingCard, Pager } from './parts'
import { CHECKIN_STATUSES, DEFAULT_LIMITS, checkinStatusLabel } from './logic'

const PAGE_SIZE = 20

export function MyCheckins({ limits = DEFAULT_LIMITS, onChanged }: { limits?: typeof DEFAULT_LIMITS; onChanged?: () => void }) {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const list = useLoad(
    () => performanceApi.checkins({ scope: 'mine', status, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [status, page],
    'Your check-ins could not be loaded.',
  )
  const requested = useLoad(
    () => performanceApi.checkins({ scope: 'mine', status: 'requested', page_size: 50 }).then((r) => r.data),
    [],
    'Requested check-ins could not be loaded.',
  )

  return (
    <section aria-labelledby="my-checkins-title" data-testid="my-checkins">
      <div className="pf-toolbar">
        <h2 id="my-checkins-title" className="pf-section-title">
          My check-ins
        </h2>
        <div className="pf-toolbar-right">
          <label className="pf-filter">
            <span className="pf-visually-hidden">Filter by status</span>
            <select
              className="pf-input pf-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
              data-testid="checkin-status-filter"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {CHECKIN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {checkinStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {!creating ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-checkin">
              <Plus size={16} aria-hidden="true" /> New check-in
            </button>
          ) : null}
        </div>
      </div>

      {flash ? (
        <p className="pf-flash" role="status" data-testid="checkin-flash">
          {flash}
        </p>
      ) : null}

      {requested.data && requested.data.items.length > 0 ? (
        <div className="card card-pad pf-requested" data-testid="requested-of-me">
          <h3 className="pf-card-title">Waiting for you ({requested.data.total})</h3>
          <p className="pf-help">A manager asked you for these check-ins. Open one to fill it in.</p>
          <CheckinRows items={requested.data.items} />
        </div>
      ) : null}

      {creating ? (
        <div className="card card-pad pf-form-card" data-testid="checkin-create-card">
          <h3 className="pf-card-title">New check-in</h3>
          <CheckinForm
            limits={limits}
            onCancel={() => setCreating(false)}
            onSaved={(c) => {
              setCreating(false)
              setFlash(`Check-in submitted: ${c.period_label}`)
              setPage(1)
              list.reload()
              requested.reload()
              onChanged?.()
            }}
          />
        </div>
      ) : null}

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <LoadingCard />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title={status ? 'No check-ins with this status' : 'You have no check-ins yet'}
          body={status ? 'Try another status filter.' : 'Submit a check-in to tell your reviewer what went well, what is blocking you and what comes next.'}
          action={
            !status && !creating ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-checkin-empty">
                <Plus size={16} aria-hidden="true" /> New check-in
              </button>
            ) : undefined
          }
        />
      ) : list.data ? (
        <>
          <CheckinRows items={list.data.items} />
          <Pager page={list.data.page} total={list.data.total} pageSize={list.data.page_size} onPage={setPage} />
        </>
      ) : null}
    </section>
  )
}
