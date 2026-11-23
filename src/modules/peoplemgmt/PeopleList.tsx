import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ShieldOff, Upload, UserPlus, UsersRound, X } from 'lucide-react'
import { DeleteDialog } from './PersonDialogs'
import { directoryApi } from '@/api/directory'
import { Avatar } from '@/components/Avatar'
import { PageTitle } from '@/pages/PageTitle'
import { EmptyState } from '@/ui/EmptyState'
import { type Person, parseFailure, peopleApi } from './api'
import { EntraSyncCard } from './EntraSyncCard'
import { MICROSOFT_PILL_TITLE, isEntraSource, leftDirectoryHint } from './entraSync'
import {
  PAGE_SIZE,
  QUERY_MAX,
  accountBadge,
  cleanQuery,
  employmentLabel,
  exactDepartment,
  failureMessage,
  formatDate,
  initialsOf,
  matchesQuery,
  pageCount,
  parsePage,
  parseStatusFilter,
  rolesText,
  signInSourceShort,
  statusLabel,
  statusTone,
} from './logic'
import { ErrorBlock, LoadingCard, Pager, Pill, useDebounced } from './parts'
import '@/pages/pages.css'
import './peoplemgmt.css'

/** The department filter has no server parameter, so it reads at most this many pages of 50 and keeps exact matches. */
const SCAN_PAGES = 10
const SCAN_SIZE = 50

type View = { items: Person[]; total: number; page: number; truncated: boolean }
type Load = { kind: 'loading' } | { kind: 'ready'; view: View } | { kind: 'error'; message: string } | { kind: 'denied' }

async function loadView(q: string, status: '' | 'active' | 'left', department: string, page: number, signal: AbortSignal): Promise<View> {
  if (!department) {
    const data = await peopleApi.list({ q, status, page, page_size: PAGE_SIZE }, signal)
    return { items: data.items, total: data.total, page: data.page, truncated: false }
  }
  // Ask the server for the department text (it matches name, email, title and department), then keep exact department matches
  // that also contain the typed search text. A literal match like the server's, done here because the API has no department filter.
  const all: Person[] = []
  let truncated = false
  for (let p = 1; p <= SCAN_PAGES; p++) {
    const data = await peopleApi.list({ q: department, status, page: p, page_size: SCAN_SIZE }, signal)
    all.push(...data.items)
    if (p * data.page_size >= data.total) break
    if (p === SCAN_PAGES) truncated = true
  }
  const kept = all.filter((x) => exactDepartment(x, department) && matchesQuery(x, q))
  const pages = pageCount(kept.length, PAGE_SIZE)
  const current = Math.min(page, pages)
  return { items: kept.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), total: kept.length, page: current, truncated }
}

/** HR: everyone on file with account info. Search, status and department filters, pages; a table on wide screens, cards below. */
export function PeopleList() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const status = parseStatusFilter(params.get('status'))
  const department = params.get('department') ?? ''
  const page = parsePage(params.get('page'))
  const [text, setText] = useState(q)
  const debounced = useDebounced(text, 300)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  // The Microsoft directory card is for HR only. The people list answering at all is the proof: until then nothing asks about the sync.
  const [listWorked, setListWorked] = useState(false)
  const [toDelete, setToDelete] = useState<Person | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const seq = useRef(0)

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
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

  useEffect(() => setText(q), [q])
  useEffect(() => {
    if (cleanQuery(debounced) !== q.trim()) update({ q: cleanQuery(debounced) || null, page: null }, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // Department names for the filter come from the normal directory (any signed-in user may read it). Failure just leaves the list short.
  useEffect(() => {
    let live = true
    directoryApi
      .list({ page_size: 1 })
      .then((d) => live && setDepartments(d.departments))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    const mine = ++seq.current
    setLoad((cur) => (cur.kind === 'ready' ? cur : { kind: 'loading' })) // keep the rows on screen while the next page loads: no blank flash
    setFetching(true)
    loadView(q, status, department, page, ctl.signal)
      .then((view) => {
        if (ctl.signal.aborted || mine !== seq.current) return
        setFetching(false)
        if (view.items.length === 0 && view.total > 0 && page > 1) return update({ page: null }, true)
        setLoad({ kind: 'ready', view })
        setListWorked(true)
      })
      .catch((err) => {
        if (ctl.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return
        setFetching(false)
        const f = parseFailure(err)
        if (f.status === 403) setLoad({ kind: 'denied' })
        else setLoad({ kind: 'error', message: failureMessage(f, 'The people list could not be loaded.') })
      })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, department, page, attempt])

  const filtersActive = Boolean(q || status || department)
  const clear = () => {
    setText('')
    setParams(new URLSearchParams(), { replace: true })
  }

  function openRow(e: MouseEvent<HTMLElement>, id: string) {
    if ((e.target as HTMLElement).closest('a,button')) return
    navigate(`/people/${encodeURIComponent(id)}`)
  }

  const header = (
    <div className="pm-head">
      <PageTitle title="People" subtitle="Add, edit and deactivate people, give them roles, or import a CSV file." />
      {load.kind !== 'denied' ? (
        <div className="pm-head-actions">
          <Link to="/people/new" className="btn btn-primary" data-testid="add-person">
            <UserPlus size={16} aria-hidden="true" /> Add person
          </Link>
          <Link to="/people/import" className="btn btn-secondary" data-testid="import-csv">
            <Upload size={16} aria-hidden="true" /> Import CSV
          </Link>
          <Link to="/people/import-201" className="btn btn-secondary" data-testid="import-201">
            <Upload size={16} aria-hidden="true" /> Import 201 file
          </Link>
        </div>
      ) : null}
    </div>
  )

  if (load.kind === 'denied') {
    return (
      <div className="page pm-page" data-testid="people-denied">
        {header}
        <EmptyState icon={<ShieldOff size={28} />} title="People management is not available" body="This page is for HR administrators. Your account does not have access to it." />
      </div>
    )
  }

  const view = load.kind === 'ready' ? load.view : null
  const shown = view?.items.length ?? 0

  return (
    <div className="page pm-page" data-testid="people-list">
      {header}

      {flash ? (
        <p className="pm-notice pm-notice-success" role="status" data-testid="people-flash">
          {flash}
        </p>
      ) : null}

      {listWorked ? <EntraSyncCard onFinished={() => setAttempt((n) => n + 1)} /> : null}

      <form className="pm-toolbar" role="search" aria-label="People filters" onSubmit={(e) => e.preventDefault()}>
        <label className="pm-search">
          <span className="sr-only">Search people</span>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            className="pm-search-input"
            placeholder="Search name, email, job title or department"
            value={text}
            maxLength={QUERY_MAX}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            data-testid="people-search"
          />
        </label>
        <label className="pm-select">
          <span className="sr-only">Department</span>
          <select value={department} onChange={(e) => update({ department: e.target.value || null, page: null })} aria-label="Department" data-testid="people-department">
            <option value="">All departments</option>
            {department && !departments.includes(department) ? <option value={department}>{department}</option> : null}
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="pm-select">
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => update({ status: e.target.value || null, page: null })} aria-label="Status" data-testid="people-status">
            <option value="">Active and left</option>
            <option value="active">Active only</option>
            <option value="left">Left only</option>
          </select>
        </label>
        {filtersActive ? (
          <button type="button" className="btn btn-secondary pm-clear" onClick={clear} data-testid="people-clear">
            <X size={16} aria-hidden="true" /> Clear filters
          </button>
        ) : null}
      </form>

      {load.kind === 'loading' ? <LoadingCard testId="people-loading" label="Loading people" /> : null}
      {load.kind === 'error' ? <ErrorBlock message={load.message} onRetry={() => setAttempt((n) => n + 1)} testId="people-error" /> : null}

      {view && view.items.length === 0 ? (
        <EmptyState
          icon={<UsersRound size={28} />}
          title={filtersActive ? 'No one matches your search' : 'No people yet'}
          body={
            filtersActive
              ? 'The search looks for the exact characters you typed in the name, email, job title and department. Try different text or clear the filters.'
              : 'Nobody has been added yet. Add the first person, or import a CSV file.'
          }
          action={
            filtersActive ? (
              <button type="button" className="btn btn-secondary" onClick={clear}>
                Clear filters
              </button>
            ) : (
              <Link to="/people/new" className="btn btn-primary">
                Add person
              </Link>
            )
          }
        />
      ) : null}

      {view && view.items.length > 0 ? (
        <>
          <p className="pm-count" role="status" data-testid="people-count">
            Showing {(view.page - 1) * PAGE_SIZE + 1}-{(view.page - 1) * PAGE_SIZE + shown} of {view.total} {view.total === 1 ? 'person' : 'people'}
          </p>
          {view.truncated ? (
            <p className="pm-notice pm-notice-warning" role="note" data-testid="people-truncated">
              The department filter looked at the first {SCAN_PAGES * SCAN_SIZE} matches only. Narrow the search to see the rest.
            </p>
          ) : null}
          <div className={`card pm-table-card${fetching ? ' is-fetching' : ''}`} aria-busy={fetching} data-testid="people-table">
            <table className="pm-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Job title and department</th>
                  <th scope="col">Employment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Sign-in</th>
                  <th scope="col" className="pm-remove-col">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((p) => {
                  const badge = accountBadge(p)
                  return (
                    <tr key={p.employee.employee_id} className="pm-row" data-testid="people-row" data-id={p.employee.employee_id} onClick={(ev) => openRow(ev, p.employee.employee_id)}>
                      <td>
                        <div className="pm-person">
                          <Avatar name={p.employee.name} initials={p.employee.avatar_initials || initialsOf(p.employee.name)} size={38} />
                          <div className="pm-person-text">
                            <span className="pm-name-line">
                              <Link to={`/people/${encodeURIComponent(p.employee.employee_id)}`} className="pm-link" data-testid="people-open">
                                {p.employee.name}
                              </Link>
                              {isEntraSource(p.employee.source) ? (
                                <Pill tone="violet" testId="source-pill" title={MICROSOFT_PILL_TITLE}>
                                  Microsoft
                                </Pill>
                              ) : null}
                            </span>
                            {p.employee.profile.personal.preferred_name ? (
                              <span className="pm-sub pm-wrap" data-testid="people-preferred">Goes by {p.employee.profile.personal.preferred_name}</span>
                            ) : null}
                            <span className="pm-sub pm-wrap">{p.employee.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="pm-wrap">{p.employee.job_title || '-'}</span>
                        <span className="pm-sub pm-wrap">{p.employee.department || '-'}</span>
                      </td>
                      <td>{employmentLabel(p.employee.employment_type)}</td>
                      <td>
                        <Pill tone={statusTone(p.employee.status)} testId="status-pill">
                          {statusLabel(p.employee.status)}
                        </Pill>
                        {p.employee.end_date ? <span className="pm-sub">Until {formatDate(p.employee.end_date)}</span> : null}
                        {leftDirectoryHint(p.employee) ? (
                          <span className="pm-sub" data-testid="left-directory-hint">
                            {leftDirectoryHint(p.employee)}
                          </span>
                        ) : null}
                      </td>
                      <td className="pm-roles-cell">{p.account.has_account ? rolesText(p.account.roles) : <span className="pm-muted">-</span>}</td>
                      <td>
                        <Pill tone={badge.tone} testId="account-badge">
                          {badge.label}
                        </Pill>
                        <span className="pm-sub">{signInSourceShort(p.account.source)}</span>
                      </td>
                      <td className="pm-remove-col">
                        {p.employee.status === 'left' ? (
                          <button type="button" className="pm-x" onClick={() => setToDelete(p)} aria-label={`Delete ${p.employee.name}`} title="Delete this person for good" data-testid="delete-person">
                            <X size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <button type="button" className="pm-x pm-x-locked" disabled aria-label={`Delete ${p.employee.name} (deactivate first)`} title="Deactivate this person first, then delete them" data-testid="delete-person-locked">
                            <X size={16} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className={`pm-cards${fetching ? ' is-fetching' : ''}`} aria-busy={fetching} data-testid="people-cards">
            {view.items.map((p) => {
              const badge = accountBadge(p)
              return (
                <li key={p.employee.employee_id}>
                  <Link to={`/people/${encodeURIComponent(p.employee.employee_id)}`} className="card pm-card" data-testid="people-card">
                    <Avatar name={p.employee.name} initials={p.employee.avatar_initials || initialsOf(p.employee.name)} size={44} />
                    <span className="pm-card-text">
                      <span className="pm-name-line">
                        <strong>{p.employee.name}</strong>
                        {isEntraSource(p.employee.source) ? (
                          <Pill tone="violet" testId="source-pill" title={MICROSOFT_PILL_TITLE}>
                            Microsoft
                          </Pill>
                        ) : null}
                      </span>
                      {p.employee.profile.personal.preferred_name ? <span className="pm-sub pm-wrap">Goes by {p.employee.profile.personal.preferred_name}</span> : null}
                      <span className="pm-sub pm-wrap">{p.employee.email}</span>
                      <span className="pm-card-meta pm-wrap">{[p.employee.job_title, p.employee.department].filter(Boolean).join(' - ')}</span>
                      <span className="pm-card-meta">{employmentLabel(p.employee.employment_type)}</span>
                      <span className="pm-card-pills">
                        <Pill tone={statusTone(p.employee.status)}>{statusLabel(p.employee.status)}</Pill>
                        <Pill tone={badge.tone}>{badge.label}</Pill>
                      </span>
                      {leftDirectoryHint(p.employee) ? <span className="pm-card-meta">{leftDirectoryHint(p.employee)}</span> : null}
                      {p.account.has_account ? <span className="pm-card-meta">{rolesText(p.account.roles)}</span> : null}
                    </span>
                  </Link>
                  {p.employee.status === 'left' ? (
                    <button type="button" className="btn pm-btn-danger pm-card-delete" onClick={() => setToDelete(p)} data-testid="delete-person-card">
                      <X size={16} aria-hidden="true" /> Delete {p.employee.name}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <Pager page={view.page} pageSize={PAGE_SIZE} total={view.total} shown={shown} onPage={(n) => update({ page: n > 1 ? String(n) : null })} testPrefix="people" />
        </>
      ) : null}
      {toDelete ? (
        <DeleteDialog
          person={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={(name) => {
            setToDelete(null)
            setFlash(`${name} was deleted.`)
            setAttempt((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}
