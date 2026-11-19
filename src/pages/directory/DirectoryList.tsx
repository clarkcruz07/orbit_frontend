import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search, UsersRound, X } from 'lucide-react'
import { directoryApi, pageHasHrFields, type DirectoryEntry, type DirectoryPage } from '@/api/directory'
import { Avatar } from '@/components/Avatar'
import { initialsOf } from '@/lib/authLogic'
import { formatDate } from '@/lib/dates'
import { EMPLOYMENT_TYPES, employmentTypeLabel, pageWindow, personStatusLabel, personStatusTone } from '@/lib/people'
import { EmptyState } from '@/ui/EmptyState'
import { Alert, Skeleton } from '@/ui/Feedback'
import { PageTitle } from '../PageTitle'
import '../pages.css'
import '../reimbursements/reimbursements.css'
import './directory.css'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

type Load = { kind: 'loading' } | { kind: 'ready'; data: DirectoryPage } | { kind: 'error'; message: string }

function failureText(status: number | undefined): string {
  if (status === 403) return "That filter isn't available to your account."
  if (status === 429) return 'Too many requests. Wait a moment and try again.'
  if (!status) return "Can't reach the Bluedge People service."
  return 'The directory could not be loaded.'
}

function EmploymentCell({ entry }: { entry: DirectoryEntry }) {
  return (
    <div className="dir-hr" data-testid="dir-hr-fields">
      <span>{employmentTypeLabel(entry.employment_type)}</span>
      <span className="r-sub">Since {formatDate(entry.start_date)}</span>
      <span className={`r-pill r-pill-${personStatusTone(entry.status)}`}>{personStatusLabel(entry.status)}</span>
    </div>
  )
}

/** Employee Directory: search, department filter, HR-only employment-type filter (only when the server sent HR fields). */
export function DirectoryList() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const q = params.get('q') ?? ''
  const department = params.get('department') ?? ''
  const employmentType = params.get('type') ?? ''
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)

  const [qText, setQText] = useState(q)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [hrFields, setHrFields] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      setNotice(null)
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace },
      )
    },
    [setParams],
  )

  // The URL is the source of truth: keep the box in step with Back/Forward and "Clear filters".
  useEffect(() => setQText(q), [q])
  useEffect(() => {
    if (qText.trim() === q.trim()) return
    const t = window.setTimeout(() => update({ q: qText.trim() || null, page: null }, true), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [qText, q, update])

  useEffect(() => {
    let live = true
    const ctrl = new AbortController()
    setLoad((cur) => (cur.kind === 'ready' ? cur : { kind: 'loading' })) // keep the rows on screen while the next page loads: no blank flash
    setFetching(true)
    directoryApi
      .list({ q, department, employment_type: employmentType, page, page_size: PAGE_SIZE }, ctrl.signal)
      .then((data) => {
        if (!live) return
        setFetching(false)
        setLoad({ kind: 'ready', data })
        if (pageHasHrFields(data.items)) setHrFields(true)
        if (data.departments.length) setDepartments(data.departments)
      })
      .catch((e: { code?: string; response?: { status?: number } }) => {
        if (!live || e?.code === 'ERR_CANCELED') return
        setFetching(false)
        const status = e?.response?.status
        if (status === 403 && employmentType) {
          // Not allowed to filter by employment type: drop the filter and say so (the list then reloads without it).
          setNotice("The employment type filter isn't available to your account, so it was removed.")
          setParams((prev) => {
            const next = new URLSearchParams(prev)
            next.delete('type')
            next.delete('page')
            return next
          }, { replace: true })
          return
        }
        setLoad({ kind: 'error', message: failureText(status) })
      })
    return () => {
      live = false
      ctrl.abort()
    }
  }, [q, department, employmentType, page, reloadKey, update])

  // A stale page number (e.g. a bookmarked page 9 after people left) falls back to page 1.
  useEffect(() => {
    if (load.kind === 'ready' && load.data.items.length === 0 && load.data.total > 0 && page > 1) update({ page: null }, true)
  }, [load, page, update])

  const filtersActive = Boolean(q || department || employmentType)
  const profileState = { from: location.search }

  function openRow(e: MouseEvent<HTMLElement>, id: string) {
    if ((e.target as HTMLElement).closest('a,button')) return
    navigate(`/directory/${encodeURIComponent(id)}`, { state: profileState })
  }

  const data = load.kind === 'ready' ? load.data : null
  const win = data ? pageWindow(data.page, data.page_size, data.total) : null

  return (
    <div className="page dir-page" data-testid="directory">
      <PageTitle title="Employee Directory" subtitle="Find colleagues, their teams and who they report to." />

      <form className="dir-toolbar" role="search" aria-label="Directory filters" onSubmit={(e) => e.preventDefault()}>
        <label className="dir-search">
          <span className="r-visually-hidden">Search the directory</span>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            className="dir-search-input"
            placeholder="Search by name, job title, department or email"
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            maxLength={64}
            autoComplete="off"
            data-testid="dir-search"
          />
        </label>
        <label className="dir-select">
          <span className="r-visually-hidden">Department</span>
          <select value={department} onChange={(e) => update({ department: e.target.value || null, page: null })} data-testid="dir-department" aria-label="Department">
            <option value="">All departments</option>
            {department && !departments.includes(department) ? <option value={department}>{department}</option> : null}
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        {hrFields ? (
          <label className="dir-select">
            <span className="r-visually-hidden">Employment type</span>
            <select value={employmentType} onChange={(e) => update({ type: e.target.value || null, page: null })} data-testid="dir-type" aria-label="Employment type">
              <option value="">All employment types</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {filtersActive ? (
          <button
            type="button"
            className="btn btn-secondary dir-clear"
            onClick={() => {
              setQText('')
              setParams(new URLSearchParams(), { replace: true })
            }}
            data-testid="dir-clear"
          >
            <X size={16} aria-hidden="true" /> Clear filters
          </button>
        ) : null}
      </form>

      {notice ? (
        <div className="dir-notice" data-testid="dir-notice">
          <Alert tone="warning">{notice}</Alert>
        </div>
      ) : null}

      {load.kind === 'error' ? (
        <div data-testid="dir-error">
          <Alert tone="danger">{load.message}</Alert>
          <button type="button" className="btn btn-secondary r-retry" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      ) : load.kind === 'loading' ? (
        <div className="card card-pad" aria-busy="true" data-testid="dir-loading">
          <span className="r-visually-hidden" role="status">
            Loading the directory
          </span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} style={{ height: 44, marginBottom: 10 }} />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={<UsersRound size={28} />}
          title={filtersActive ? 'No one matches your search' : 'The directory is empty'}
          body={filtersActive ? 'Try a different name or clear the filters.' : 'People will appear here once they have been added.'}
          action={
            filtersActive ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setQText('')
                  setParams(new URLSearchParams(), { replace: true })
                }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : data && win ? (
        <>
          <p className="dir-count" role="status" data-testid="dir-count">
            Showing {win.from}-{win.to} of {data.total} {data.total === 1 ? 'person' : 'people'}
          </p>
          <div className={`card r-table-card dir-table-card${fetching ? ' is-fetching' : ''}`} aria-busy={fetching} data-testid="dir-table">
            <table className="r-table dir-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Department</th>
                  <th scope="col">Email</th>
                  <th scope="col">Manager</th>
                  {hrFields ? <th scope="col">Employment</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.employee_id} className="dir-row" data-testid="dir-row" data-id={e.employee_id} onClick={(ev) => openRow(ev, e.employee_id)}>
                    <td>
                      <div className="dir-person">
                        <Avatar name={e.name} initials={e.avatar_initials ?? initialsOf(e.name)} size={38} />
                        <div className="dir-person-text">
                          <Link to={`/directory/${encodeURIComponent(e.employee_id)}`} state={profileState} className="r-row-link" data-testid="dir-open">
                            {e.name}
                          </Link>
                          <span className="r-sub">{e.job_title ?? '-'}</span>
                        </div>
                      </div>
                    </td>
                    <td>{e.department ?? <span className="r-muted">-</span>}</td>
                    <td className="dir-email">{e.email ?? <span className="r-muted">-</span>}</td>
                    <td>{e.manager ? e.manager.name : <span className="r-muted">-</span>}</td>
                    {hrFields ? (
                      <td>
                        <EmploymentCell entry={e} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="dir-cards" data-testid="dir-cards">
            {data.items.map((e) => (
              <li key={e.employee_id}>
                <Link to={`/directory/${encodeURIComponent(e.employee_id)}`} state={profileState} className="card dir-card" data-testid="dir-card">
                  <Avatar name={e.name} initials={e.avatar_initials ?? initialsOf(e.name)} size={44} />
                  <span className="dir-card-text">
                    <strong>{e.name}</strong>
                    <span className="r-sub">{e.job_title ?? '-'}</span>
                    <span className="dir-card-meta">{[e.department, e.manager ? `Reports to ${e.manager.name}` : null].filter(Boolean).join(' - ')}</span>
                    {e.email ? <span className="dir-card-email">{e.email}</span> : null}
                    {hrFields ? (
                      <span className="dir-card-hr">
                        {employmentTypeLabel(e.employment_type)} - since {formatDate(e.start_date)}
                        <span className={`r-pill r-pill-${personStatusTone(e.status)}`}>{personStatusLabel(e.status)}</span>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <nav className="dir-pager" aria-label="Directory pages" data-testid="dir-pager">
            <button type="button" className="btn btn-secondary" disabled={!win.hasPrev} onClick={() => update({ page: win.page - 1 > 1 ? String(win.page - 1) : null })} data-testid="dir-prev">
              <ChevronLeft size={16} aria-hidden="true" /> Previous
            </button>
            <span className="dir-pager-label" data-testid="dir-page-label">
              Page {win.page} of {win.pages}
            </span>
            <button type="button" className="btn btn-secondary" disabled={!win.hasNext} onClick={() => update({ page: String(win.page + 1) })} data-testid="dir-next">
              Next <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        </>
      ) : null}
    </div>
  )
}
