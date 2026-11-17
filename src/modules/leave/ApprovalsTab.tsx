import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ListScope } from './api'
import { SCOPE_LABEL, SCOPE_SUB, parseScope } from './logic'
import { useLeaveTypes } from './parts'
import { RequestsPanel } from './RequestsPanel'

const EMPTY: Record<ListScope, { title: string; body: string }> = {
  mine: { title: 'No requests', body: '' },
  review: { title: 'Nothing is waiting for your decision', body: 'Pending leave requests that you can decide will appear here.' },
  team: { title: 'No requests from your team', body: 'Leave requests from the people who report to you will appear here.' },
  all: { title: 'No leave requests', body: 'Leave requests across the company will appear here.' },
}

/** Approver queue plus the read-only lists the server allows for this account. `scopes` is a navigation hint; the server decides. */
export function ApprovalsTab({ scopes, currentYear }: { scopes: ListScope[]; currentYear: number }) {
  const [params, setParams] = useSearchParams()
  const scope = parseScope(params.get('scope'), scopes)
  const { types } = useLeaveTypes()
  const years = useMemo(() => [currentYear + 1, currentYear, currentYear - 1, currentYear - 2], [currentYear])

  function pick(next: ListScope) {
    // A new list starts clean: filters and page of the previous one do not apply.
    const p = new URLSearchParams()
    p.set('tab', 'approvals')
    if (next !== scopes[0]) p.set('scope', next)
    setParams(p, { replace: true })
  }

  return (
    <div data-testid="tab-panel-approvals">
      {scopes.length > 1 ? (
        <div className="lv-segments" role="group" aria-label="Which requests to show">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              className={`lv-segment${scope === s ? ' active' : ''}`}
              aria-pressed={scope === s}
              onClick={() => pick(s)}
              data-testid={`approvals-scope-${s}`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="lv-scope-sub" data-testid="approvals-sub">
        {SCOPE_SUB[scope]}
      </p>
      <RequestsPanel
        key={scope}
        scope={scope}
        showEmployee
        types={types}
        years={years}
        allowStatusFilter={scope !== 'review'}
        emptyTitle={EMPTY[scope].title}
        emptyBody={EMPTY[scope].body}
      />
    </div>
  )
}
