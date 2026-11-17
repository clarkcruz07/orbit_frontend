import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarOff, ClipboardCheck } from 'lucide-react'
import { Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi, type LeaveType, type ListScope, type RequestPage } from './api'
import { STATUS_ORDER, friendlyError, isStatus, parseLeaveError, parsePage, statusLabel } from './logic'
import { Pager, RequestList } from './parts'

export const PAGE_SIZE = 10

type Load = { kind: 'loading' } | { kind: 'ready'; data: RequestPage } | { kind: 'error'; message: string; forbidden: boolean }

interface Props {
  scope: ListScope
  showEmployee: boolean
  /** Types for the type filter (loaded by the parent); the filter is hidden while this is null/empty. */
  types: LeaveType[] | null
  /** Years offered by the year filter. */
  years: number[]
  /** Statuses cannot be filtered for the "review" queue (it is always pending). */
  allowStatusFilter: boolean
  emptyTitle: string
  emptyBody: string
  newLink?: ReactNode
}

/** Filter bar + list + pager for one request scope. Filters and page live in the URL (`status`, `type`, `year`, `page`). */
export function RequestsPanel({ scope, showEmployee, types, years, allowStatusFilter, emptyTitle, emptyBody, newLink }: Props) {
  const [params, setParams] = useSearchParams()
  const status = isStatus(params.get('status')) ? (params.get('status') as string) : ''
  const typeId = types?.some((t) => t.type_id === params.get('type')) ? (params.get('type') as string) : ''
  const yearRaw = Number(params.get('year'))
  const year = years.includes(yearRaw) ? yearRaw : 0
  const page = parsePage(params.get('page'))
  const [load, setLoad] = useState<Load>({ kind: 'loading' })

  const run = useCallback(() => {
    let live = true
    setLoad({ kind: 'loading' })
    leaveApi
      .list({ scope, status: allowStatusFilter ? status || undefined : undefined, type_id: typeId || undefined, year: year || undefined, page, page_size: PAGE_SIZE })
      .then((data) => {
        if (!live) return
        // A stale page number (the list shrank) falls back to the last real page instead of an empty screen.
        const last = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
        if (data.items.length === 0 && page > last) {
          const p = new URLSearchParams(params)
          if (last > 1) p.set('page', String(last))
          else p.delete('page')
          setParams(p, { replace: true })
          return
        }
        setLoad({ kind: 'ready', data })
      })
      .catch((e) => {
        if (!live) return
        const info = parseLeaveError(e, 'The requests could not be loaded.')
        setLoad({ kind: 'error', message: friendlyError(info), forbidden: info.status === 403 })
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status, typeId, year, page, allowStatusFilter])

  useEffect(() => run(), [run])

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    if (key !== 'page') p.delete('page')
    setParams(p, { replace: true })
  }

  const filtered = Boolean(status || typeId || year)

  return (
    <div data-testid="requests-panel" data-scope={scope}>
      <div className="lv-filters" role="group" aria-label="Filter requests">
        {allowStatusFilter ? (
          <label className="lv-filter">
            <span className="lv-filter-label">Status</span>
            <select className="lv-input" value={status} onChange={(e) => setParam('status', e.target.value)} data-testid="leave-status-filter">
              <option value="">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {types && types.length > 0 ? (
          <label className="lv-filter">
            <span className="lv-filter-label">Type</span>
            <select className="lv-input" value={typeId} onChange={(e) => setParam('type', e.target.value)} data-testid="leave-type-filter">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.type_id} value={t.type_id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="lv-filter">
          <span className="lv-filter-label">Year</span>
          <select className="lv-input" value={year ? String(year) : ''} onChange={(e) => setParam('year', e.target.value)} data-testid="leave-year-filter">
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <button
            type="button"
            className="btn btn-secondary lv-clear"
            onClick={() => {
              const p = new URLSearchParams(params)
              for (const k of ['status', 'type', 'year', 'page']) p.delete(k)
              setParams(p, { replace: true })
            }}
            data-testid="leave-clear-filters"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {load.kind === 'error' ? (
        <div data-testid="leave-list-error">
          {load.forbidden ? (
            <EmptyState icon={<ClipboardCheck size={28} />} title="This list is not available to you" body={load.message} />
          ) : (
            <EmptyState
              icon={<CalendarOff size={28} />}
              title="The requests could not be loaded"
              body={load.message}
              action={
                <button type="button" className="btn btn-secondary" onClick={() => run()}>
                  Try again
                </button>
              }
            />
          )}
        </div>
      ) : load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="leave-list-loading">
          <span className="sr-only" role="status">
            Loading leave requests
          </span>
          <Skeleton style={{ height: 18, width: '40%', marginBottom: 14 }} />
          <Skeleton style={{ height: 14, width: '90%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '80%' }} />
        </div>
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={scope === 'review' ? <ClipboardCheck size={28} /> : <CalendarOff size={28} />}
          title={filtered ? 'No requests match these filters' : emptyTitle}
          body={filtered ? 'Try different filters, or clear them.' : emptyBody}
          action={!filtered ? newLink : undefined}
        />
      ) : (
        <>
          <RequestList items={load.data.items} showEmployee={showEmployee} />
          <Pager total={load.data.total} page={load.data.page} pageSize={load.data.page_size} onPage={(p) => setParam('page', p > 1 ? String(p) : '')} />
        </>
      )}
    </div>
  )
}
