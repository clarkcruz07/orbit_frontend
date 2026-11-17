import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { USERS_PAGE_SIZE, USERS_QUERY_MAX, settingsApi, type UsersPage, type UserRow } from './api'
import { ROLES_NOTE, authSourceLabel, authSourceShort, authSourceTone, cleanQuery, describeError, initialsOf, pageCount, parsePage, rangeText, rolesText } from './logic'
import { Badge, Panel, RowsSkeleton, useDebounced } from './parts'

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: UsersPage }

/** "Users and roles": a READ-ONLY, paginated, searchable table. There is no edit control anywhere: roles come from configuration. */
export function UsersTab() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? ''
  const page = parsePage(params.get('page'))
  const [text, setText] = useState(urlQuery)
  const debounced = useDebounced(text, 300)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const query = cleanQuery(urlQuery, USERS_QUERY_MAX)
  const abort = useRef<AbortController | null>(null)

  const update = useCallback(
    (next: { q?: string; page?: number }) => {
      const p = new URLSearchParams(params)
      const q = next.q !== undefined ? cleanQuery(next.q, USERS_QUERY_MAX) : (p.get('q') ?? '')
      const pg = next.page ?? 1
      if (q) p.set('q', q)
      else p.delete('q')
      if (pg > 1) p.set('page', String(pg))
      else p.delete('page')
      setParams(p, { replace: next.q !== undefined })
    },
    [params, setParams],
  )

  // The URL follows the (debounced) search box; a new search always starts on page 1.
  useEffect(() => {
    if (cleanQuery(debounced, USERS_QUERY_MAX) !== query) update({ q: debounced })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  useEffect(() => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setLoad({ kind: 'loading' })
    settingsApi
      .users({ q: query, page, pageSize: USERS_PAGE_SIZE }, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return
        // A stale bookmarked page number past the end falls back to page 1.
        if (data.items.length === 0 && data.total > 0 && page > 1) return update({ page: 1 })
        setLoad({ kind: 'ready', data })
      })
      .catch((err) => {
        if (ctl.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return
        setLoad({ kind: 'error', message: describeError(err, 'The user list could not be loaded.').message })
      })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page, attempt])

  const data = load.kind === 'ready' ? load.data : null
  const pages = data ? pageCount(data.total, data.page_size) : 1

  return (
    <div className="st-stack" data-testid="tab-users">
      <Alert tone="info">
        <span data-testid="roles-note">{ROLES_NOTE}</span>
      </Alert>
      <p style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: 0, fontSize: 13.5, lineHeight: '20px' }} data-testid="manage-people-note">
        <span style={{ flex: '1 1 320px' }}>
          HR administrators can now add people, change their roles and deactivate them on the People pages. Roles that come from configuration can still be re-applied over what is set there.
        </span>
        <Link to="/people" className="btn btn-secondary" data-testid="manage-people-link">
          Manage people
        </Link>
      </p>
      <Panel id="st-users-h" title="Users and roles" sub="Everyone who can sign in. This list is read-only." testId="users-panel">
        <div className="st-toolbar">
          <label className="st-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search users</span>
            <input
              type="search"
              className="st-search-input"
              placeholder="Search users"
              value={text}
              maxLength={USERS_QUERY_MAX}
              onChange={(e) => setText(e.target.value)}
              data-testid="users-search"
              autoComplete="off"
            />
          </label>
          {text ? (
            <button type="button" className="btn btn-secondary st-clear" onClick={() => setText('')} data-testid="users-clear">
              <X size={16} aria-hidden="true" /> Clear
            </button>
          ) : null}
        </div>

        {load.kind === 'loading' ? <RowsSkeleton rows={5} height={52} /> : null}
        {load.kind === 'error' ? (
          <div className="st-error" data-testid="users-error">
            <Alert tone="danger">{load.message}</Alert>
            <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {data && data.items.length === 0 ? (
          <EmptyState
            plain
            title={query ? 'No one matches your search' : 'No users yet'}
            body={query ? 'Nobody matches that text. The search looks for the exact characters you typed in the name, email, department and job title.' : 'There are no accounts to show.'}
            action={
              query ? (
                <button type="button" className="btn btn-secondary" onClick={() => setText('')}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        ) : null}
        {data && data.items.length > 0 ? (
          <>
            <p className="st-count" data-testid="users-count" aria-live="polite">
              Showing {rangeText(data.page, data.page_size, data.total, data.items.length)} {data.total === 1 ? 'person' : 'people'}
            </p>
            <div className="st-table-wrap">
              <table className="st-table" data-testid="users-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Sign-in</th>
                    <th scope="col">Department</th>
                    <th scope="col">Job title</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.user_id} data-testid="user-row">
                      <td>
                        <span className="st-person">
                          <Avatar name={u.name} initials={initialsOf(u.name)} size={34} />
                          <span className="st-person-text">
                            <strong>{u.name}</strong>
                          </span>
                        </span>
                      </td>
                      <td className="st-email">{u.email}</td>
                      <td>{rolesText(u.roles)}</td>
                      <td>
                        <Badge tone={authSourceTone(u.auth_source)}>{authSourceShort(u.auth_source)}</Badge>
                      </td>
                      <td>{u.department ?? '-'}</td>
                      <td>{u.job_title ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="st-cards" data-testid="users-cards">
              {data.items.map((u) => (
                <UserCard key={u.user_id} u={u} />
              ))}
            </ul>
            <nav className="st-pager" aria-label="Users pages" data-testid="users-pager">
              <button type="button" className="btn btn-secondary" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 })} data-testid="users-prev">
                <ChevronLeft size={16} aria-hidden="true" /> Previous
              </button>
              <span className="st-pager-label" data-testid="users-page-label">
                Page {data.page} of {pages}
              </span>
              <button type="button" className="btn btn-secondary" disabled={data.page >= pages} onClick={() => update({ page: data.page + 1 })} data-testid="users-next">
                Next <ChevronRight size={16} aria-hidden="true" />
              </button>
            </nav>
          </>
        ) : null}
      </Panel>
    </div>
  )
}

function UserCard({ u }: { u: UserRow }) {
  return (
    <li className="st-card-row" data-testid="user-card">
      <div className="st-person">
        <Avatar name={u.name} initials={initialsOf(u.name)} size={38} />
        <span className="st-person-text">
          <strong>{u.name}</strong>
          <span className="st-wrap st-muted">{u.email}</span>
        </span>
      </div>
      <div className="st-card-badges">
        <Badge tone={authSourceTone(u.auth_source)}>{authSourceLabel(u.auth_source)}</Badge>
      </div>
      <dl className="st-card-facts">
        <div>
          <dt>Roles</dt>
          <dd>{rolesText(u.roles)}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{u.department ?? '-'}</dd>
        </div>
        <div>
          <dt>Job title</dt>
          <dd>{u.job_title ?? '-'}</dd>
        </div>
      </dl>
    </li>
  )
}
