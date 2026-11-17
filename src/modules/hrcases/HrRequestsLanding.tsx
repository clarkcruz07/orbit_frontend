import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Plus, Receipt, Users } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { useAuthStore } from '@/stores/authStore'
import { useLoad } from '@/modules/documents/hooks'
import { casesApi, type CasePage } from './api'
import { CaseList, PAGE_SIZE } from './CaseList'
import { Notice } from './parts'
import {
  PRIVACY_NOTE,
  STATUS_FILTERS,
  parseAssigneeFilter,
  parseListTab,
  parsePage,
  parsePriorityFilter,
  parseStatusFilter,
  showQueueTab,
  PRIORITIES,
  priorityLabel,
  type ListTab,
} from './logic'
import './hrcases.css'

/** HR Requests landing: links to Reimbursements and the directory, my cases with "New request", and (for HR) the queue. */
export function HrRequestsLanding() {
  const user = useAuthStore((s) => s.user)
  const queueAllowed = useMemo(() => showQueueTab(user?.roles), [user?.roles])
  const [params, setParams] = useSearchParams()
  const tab: ListTab = parseListTab(params.get('tab'), queueAllowed)
  const status = parseStatusFilter(params.get('status'))
  const priority = parsePriorityFilter(params.get('priority'))
  const assignee = parseAssigneeFilter(params.get('assignee'))
  const typeId = params.get('type') ?? ''
  const page = parsePage(params.get('page'))

  function update(changes: Record<string, string | null>, keepPage = false) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (!keepPage) p.delete('page')
    setParams(p, { replace: true })
  }
  function setTab(next: ListTab) {
    const p = new URLSearchParams()
    if (next === 'queue') p.set('tab', 'queue')
    setParams(p, { replace: true })
  }

  const types = useLoad(() => casesApi.types().then((r) => r.data.items), [], 'The request types could not be loaded.')
  const list = useLoad<CasePage>(
    () =>
      casesApi
        .list({
          scope: tab,
          status: status || undefined,
          priority: tab === 'queue' ? priority || undefined : undefined,
          assignee: tab === 'queue' ? assignee || undefined : undefined,
          type_id: typeId || undefined,
          page,
          page_size: PAGE_SIZE,
        })
        .then((r) => r.data),
    [tab, status, priority, assignee, typeId, page],
    'The requests could not be loaded.',
  )

  const filtered = Boolean(status || priority || assignee || typeId)

  return (
    <div className="page dc-page" data-testid="hr-requests-page" data-tab={tab}>
      <PageTitle title="HR Requests" subtitle="Raise a request with HR and follow your cases." />

      <ul className="hc-links" aria-label="Other places">
        <li>
          <Link to="/reimbursements" className="hc-linkcard" data-testid="request-reimbursements">
            <span className="hc-linkcard-icon">
              <Receipt size={22} aria-hidden="true" />
            </span>
            <span className="hc-linkcard-text">
              <strong>Reimbursements</strong>
              <span>Submit a receipt, review it and send it for approval.</span>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="/directory" className="hc-linkcard" data-testid="browse-directory">
            <span className="hc-linkcard-icon">
              <Users size={22} aria-hidden="true" />
            </span>
            <span className="hc-linkcard-text">
              <strong>Browse the directory</strong>
              <span>Find colleagues, managers and teams.</span>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </li>
      </ul>

      <Notice testId="privacy-note">{PRIVACY_NOTE}</Notice>

      <div className="hc-head">
        <div className="dc-tabs" role="tablist" aria-label="HR requests">
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={`dc-tab${tab === 'mine' ? ' active' : ''}`} onClick={() => setTab('mine')} data-testid="tab-mine">
            My requests
          </button>
          {queueAllowed ? (
            <button type="button" role="tab" aria-selected={tab === 'queue'} className={`dc-tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')} data-testid="tab-queue">
              HR queue
            </button>
          ) : null}
        </div>
        <Link to="/hr-requests/new" className="btn btn-primary" data-testid="new-request">
          <Plus size={16} aria-hidden="true" /> New request
        </Link>
      </div>

      <div className="hc-filters" data-testid="case-filters">
        <label className="hc-filter">
          <span className="dc-label-inline">Status</span>
          <select className="dc-input" value={status} onChange={(e) => update({ status: e.target.value })} aria-label="Filter by status" data-testid="filter-status">
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {tab === 'queue' ? (
          <>
            <label className="hc-filter">
              <span className="dc-label-inline">Priority</span>
              <select className="dc-input" value={priority} onChange={(e) => update({ priority: e.target.value })} aria-label="Filter by priority" data-testid="filter-priority">
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="hc-filter">
              <span className="dc-label-inline">Assignee</span>
              <select className="dc-input" value={assignee} onChange={(e) => update({ assignee: e.target.value })} aria-label="Filter by assignee" data-testid="filter-assignee">
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="hc-filter">
          <span className="dc-label-inline">Type</span>
          <select className="dc-input" value={typeId} onChange={(e) => update({ type: e.target.value })} aria-label="Filter by type" data-testid="filter-type">
            <option value="">All types</option>
            {(types.data ?? []).map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <button type="button" className="btn btn-secondary" onClick={() => update({ status: null, priority: null, assignee: null, type: null })} data-testid="filters-clear">
            Clear filters
          </button>
        ) : null}
      </div>

      <section aria-label={tab === 'queue' ? 'HR queue' : 'My requests'} data-testid={tab === 'queue' ? 'queue-panel' : 'mine-panel'}>
        {tab === 'queue' ? (
          <p className="dc-fine hc-lead">Every request, newest activity first. Open one for the conversation; status, priority and assignment can also be changed here.</p>
        ) : null}
        <CaseList
          list={list}
          page={page}
          onPage={(n) => update({ page: n > 1 ? String(n) : null }, true)}
          queue={tab === 'queue'}
          filtered={filtered}
          emptyTitle={tab === 'queue' ? 'The queue is empty' : 'No requests yet'}
          emptyBody={tab === 'queue' ? 'New requests from employees will appear here.' : 'Use "New request" to ask HR for a certificate, an equipment change, a profile update or anything else.'}
        />
      </section>
    </div>
  )
}
