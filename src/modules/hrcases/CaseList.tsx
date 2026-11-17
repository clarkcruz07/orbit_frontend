import { Link } from 'react-router-dom'
import { Inbox, MessageSquare } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import type { CaseDetail, CasePage, CaseSummary } from './api'
import { CaseControls } from './CaseControls'
import { assigneeText, formatDateTime, lastActivityText } from './logic'
import { ErrorBlock, LoadingCard, Pager, PriorityPill, StatusPill } from './parts'
import type { LoadState } from '@/modules/documents/hooks'

const PAGE_SIZE = 20
export { PAGE_SIZE }

interface Props {
  list: LoadState<CasePage>
  page: number
  onPage: (page: number) => void
  /** HR queue: show who raised each request, the assignee and the inline controls. */
  queue: boolean
  filtered: boolean
  emptyTitle: string
  emptyBody: string
}

export function CaseList({ list, page, onPage, queue, filtered, emptyTitle, emptyBody }: Props) {
  const me = useAuthStore((s) => s.user?.user_id ?? null)
  const items = list.data?.items ?? []

  function replace(next: CaseDetail) {
    list.setData((prev) => (prev ? { ...prev, items: prev.items.map((c) => (c.case_id === next.case_id ? ({ ...c, ...next } as CaseSummary) : c)) } : prev))
  }

  if (list.error) {
    return <ErrorBlock message={list.error.status === 403 ? 'The HR queue is for HR only.' : list.error.detail} onRetry={list.reload} testId="cases-error" />
  }
  if (list.loading && !list.data) return <LoadingCard testId="cases-loading" />
  if (items.length === 0) {
    return <EmptyState icon={<Inbox size={28} />} title={filtered ? 'No requests match these filters' : emptyTitle} body={filtered ? 'Try different filters, or clear them.' : emptyBody} />
  }

  return (
    <>
      <p className="dc-fine" data-testid="cases-total">
        {list.data?.total ?? items.length} request{(list.data?.total ?? items.length) === 1 ? '' : 's'}
      </p>
      <ul className="dc-list" data-testid="case-rows" aria-busy={list.loading}>
        {items.map((c) => (
          <li key={c.case_id} className="dc-row card hc-row" data-testid="case-row" data-case-id={c.case_id} data-status={c.status} data-priority={c.priority}>
            <div className="dc-row-main">
              <div className="dc-row-body">
                <div className="dc-row-title">
                  <Link to={`/hr-requests/cases/${encodeURIComponent(c.case_id)}`} className="hc-row-link" data-testid="case-open">
                    {c.subject}
                  </Link>
                </div>
                <div className="hc-pills">
                  <StatusPill status={c.status} />
                  <PriorityPill priority={c.priority} />
                </div>
                <div className="dc-sub" data-testid="case-type">
                  {c.type.name}
                  {queue && c.employee ? ` - from ${c.employee.name ?? c.employee.employee_id}${c.employee.department ? ` (${c.employee.department})` : ''}` : ''}
                </div>
                <div className="dc-sub">
                  <MessageSquare size={12} aria-hidden="true" /> {lastActivityText(c)} - updated {formatDateTime(c.updated_at)}
                  {queue ? ` - ${assigneeText(c.assignee, me)}` : c.assignee ? ` - handled by ${c.assignee.name}` : ''}
                </div>
              </div>
            </div>
            {queue ? (
              <CaseControls c={c} compact onChanged={replace} onStale={list.reload} />
            ) : null}
          </li>
        ))}
      </ul>
      <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={onPage} />
    </>
  )
}
