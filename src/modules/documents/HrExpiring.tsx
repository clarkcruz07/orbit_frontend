import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { documentsApi, type ExpiringPage } from './api'
import { DocumentRow } from './DocumentRow'
import { useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pager } from './parts'
import { formatDate } from './logic'

const PAGE_SIZE = 20
const WINDOWS = [30, 60, 90, 180, 365]

/** HR: documents expiring soon across all employees (names visible to HR only). */
export function HrExpiring() {
  const [days, setDays] = useState(30)
  const [includeExpired, setIncludeExpired] = useState(true)
  const [page, setPage] = useState(1)
  const list = useLoad<ExpiringPage>(
    () => documentsApi.expiring({ days, include_expired: includeExpired, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [days, includeExpired, page],
    'The expiring documents could not be loaded.',
  )
  const items = list.data?.items ?? []

  return (
    <div data-testid="hr-expiring">
      <div className="dc-toolbar">
        <label className="dc-filter">
          <span className="dc-label-inline">Expiring within</span>
          <select className="dc-input" value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1) }} aria-label="Expiring within" data-testid="expiring-days">
            {WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="dc-check">
          <input type="checkbox" checked={includeExpired} onChange={(e) => { setIncludeExpired(e.target.checked); setPage(1) }} data-testid="expiring-include-expired" /> Include already expired
        </label>
      </div>
      {list.data ? (
        <p className="dc-fine" data-testid="expiring-today">
          Today is {formatDate(list.data.today)}. {list.data.total} document{list.data.total === 1 ? '' : 's'} in this window.
        </p>
      ) : null}
      {list.error ? (
        <ErrorBlock message={list.error.status === 403 ? 'This list is for HR only.' : list.error.detail} onRetry={list.reload} testId="expiring-error" />
      ) : list.loading && !list.data ? (
        <LoadingCard testId="expiring-loading" />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarClock size={28} />} title="Nothing is expiring" body={`No employee document expires within ${days} days${includeExpired ? ' and none has already expired' : ''}.`} />
      ) : (
        <>
          <ul className="dc-list" data-testid="expiring-rows">
            {items.map((d) => (
              <DocumentRow
                key={d.doc_id}
                doc={d}
                showEmployee
                onChanged={(next) => list.setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.doc_id === next.doc_id ? { ...x, ...next, versions: undefined } : x)) } : prev))}
              />
            ))}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
