import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, FileSpreadsheet, Plus, Receipt } from 'lucide-react'
import { reimbursementsApi, type ReimbursementSummary } from '@/api/reimbursements'
import { useAuthStore } from '@/stores/authStore'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PaydayBadge } from '@/ui/Payday'
import { normalisePayday } from '@/lib/payday'
import { saveBlob } from '@/modules/assistant/download'
import { PageTitle } from '../PageTitle'
import { StatusPill } from './parts'
import { SCOPE_LABEL, STATUS_ORDER, availableScopes, formatDate, formatDateTime, formatMoney, parseScope, statusLabel, parseServerError, type Scope } from './logic'
import '../pages.css'
import './reimbursements.css'

const SUBTITLE: Record<Scope, string> = {
  mine: 'Receipts you have submitted or are preparing.',
  review: 'Requests waiting for your decision.',
  all: 'Everything you are allowed to see. Oversight is read-only unless a request is waiting for your decision.',
}

export function ReimbursementsList() {
  const user = useAuthStore((s) => s.user)
  const scopes = useMemo(() => availableScopes(user?.roles), [user?.roles])
  const [params, setParams] = useSearchParams()
  const scope = parseScope(params.get('tab'), scopes)
  const status = STATUS_ORDER.find((s) => s === params.get('status')) ?? ''

  const [items, setItems] = useState<ReimbursementSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(() => {
    let live = true
    setItems(null)
    setError(null)
    reimbursementsApi
      .list(scope, status || undefined)
      .then((r) => live && setItems(r.data))
      .catch((e) => live && setError(parseServerError(e, 'The requests could not be loaded.').detail))
    return () => {
      live = false
    }
  }, [scope, status])

  useEffect(() => load(), [load])

  function setTab(next: Scope) {
    const p = new URLSearchParams(params)
    if (next === 'mine') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }
  function setStatus(next: string) {
    const p = new URLSearchParams(params)
    if (next) p.set('status', next)
    else p.delete('status')
    setParams(p, { replace: true })
  }

  const showEmployee = scope !== 'mine'

  /** Downloads exactly what this tab and status filter show, as an Excel file. */
  async function exportToExcel() {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const res = await reimbursementsApi.exportXlsx(scope, status || undefined)
      const day = new Date()
      const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      saveBlob(res.data, `reimbursements-${scope}${status ? `-${status}` : ''}-${stamp}.xlsx`)
    } catch (err) {
      setExportError(parseServerError(err, 'The Excel file could not be created. Please try again.').detail)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page r-page" data-testid="reimb-list">
      <PageTitle title="Reimbursements" subtitle="Submit a receipt, review the details and send it for approval." />

      <div className="r-toolbar">
        <div className="r-tabs" role="tablist" aria-label="Reimbursement lists">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={`r-tab${scope === s ? ' active' : ''}`}
              data-testid={`tab-${s}`}
              onClick={() => setTab(s)}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="r-toolbar-right">
          <label className="r-filter">
            <span className="r-visually-hidden">Filter by status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="status-filter" aria-label="Filter by status">
              <option value="">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void exportToExcel()} disabled={exporting || items === null || items.length === 0} data-testid="export-xlsx" title="Download these requests as an Excel file">
            <FileSpreadsheet size={16} aria-hidden="true" /> {exporting ? 'Preparing...' : 'Export to Excel'}
          </button>
          <Link to="/reimbursements/new" className="btn btn-primary" data-testid="new-reimbursement">
            <Plus size={16} aria-hidden="true" /> New reimbursement
          </Link>
        </div>
      </div>
      <p className="r-scope-sub">{SUBTITLE[scope]}</p>
      {exportError ? (
        <div data-testid="export-error">
          <Alert tone="danger">{exportError}</Alert>
        </div>
      ) : null}

      {error ? (
        <div data-testid="list-error">
          <Alert tone="danger">{error}</Alert>
          <button type="button" className="btn btn-secondary r-retry" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : items === null ? (
        <div className="card card-pad" aria-busy="true" data-testid="list-loading">
          <Skeleton style={{ height: 18, width: '40%', marginBottom: 14 }} />
          <Skeleton style={{ height: 14, width: '90%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '80%' }} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={scope === 'review' ? <ClipboardCheck size={28} /> : <Receipt size={28} />}
          title={status ? 'No requests with this status' : scope === 'review' ? 'Nothing is waiting for your review' : scope === 'all' ? 'No requests to show' : 'No reimbursement requests yet'}
          body={
            status
              ? 'Try another status filter.'
              : scope === 'review'
                ? 'Requests that need your decision will appear here.'
                : scope === 'all'
                  ? 'Submitted requests you can see will appear here.'
                  : 'Start a new reimbursement to upload a receipt and send it for approval.'
          }
          action={
            scope === 'mine' && !status ? (
              <Link to="/reimbursements/new" className="btn btn-primary">
                <Plus size={16} aria-hidden="true" /> New reimbursement
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="card r-table-card" data-testid="reimb-table">
            <table className="r-table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Merchant</th>
                  <th scope="col">Receipt date</th>
                  <th scope="col" className="r-num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.request_id} data-testid="reimb-row" data-status={it.status} data-id={it.request_id}>
                    <td>
                      <Link to={`/reimbursements/${it.request_id}`} className="r-row-link" data-testid="reimb-open">
                        {it.purpose}
                      </Link>
                      {showEmployee ? (
                        <div className="r-sub">
                          {it.employee_name ?? 'Unknown'}
                          {it.department ? ` - ${it.department}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{it.merchant ?? <span className="r-muted">-</span>}</td>
                    <td>{formatDate(it.receipt_date)}</td>
                    <td className="r-num">{formatMoney(it.currency, it.total_amount)}</td>
                    <td>
                      <StatusPill status={it.status} />
                      <PaydayBadge payday={normalisePayday(it.payday)} testId="row-payday" />
                    </td>
                    <td className="r-muted">{formatDateTime(it.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="r-cards" data-testid="reimb-cards">
            {items.map((it) => (
              <li key={it.request_id}>
                <Link to={`/reimbursements/${it.request_id}`} className="r-card-item card" data-testid="reimb-card">
                  <div className="r-card-top">
                    <strong>{it.purpose}</strong>
                    <StatusPill status={it.status} />
                  </div>
                  {showEmployee ? <div className="r-sub">{it.employee_name ?? 'Unknown'}</div> : null}
                  <PaydayBadge payday={normalisePayday(it.payday)} testId="card-payday" />
                  <div className="r-card-meta">
                    <span>{it.merchant ?? '-'}</span>
                    <span>{formatDate(it.receipt_date)}</span>
                    <span className="r-card-amount">{formatMoney(it.currency, it.total_amount)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
