import { useMemo, type KeyboardEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { PageTitle } from '@/pages/PageTitle'
import { ApprovalsTab } from './ApprovalsTab'
import { MyLeaveTab } from './MyLeaveTab'
import { SettingsTab } from './SettingsTab'
import { TeamCalendarTab } from './TeamCalendarTab'
import { TAB_LABEL, TAB_PARAM, availableTabs, listScopesFor, parseTab, type TabId } from './logic'
import { useLeaveConfig } from './parts'
import '@/pages/pages.css'
import './leave.css'

/** Notification deep links look like `/leave?request=<id>`: open that request's detail page. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function LeavePage() {
  const [params, setParams] = useSearchParams()
  const roles = useAuthStore((s) => s.user?.roles)
  const { today, year } = useLeaveConfig()
  const tabs = useMemo(() => availableTabs(roles), [roles])
  const scopes = useMemo(() => listScopesFor(roles), [roles])
  const tab = parseTab(params.get('tab'), tabs)

  const requestId = params.get('request')
  if (requestId && SAFE_ID.test(requestId)) return <Navigate to={`/leave/${encodeURIComponent(requestId)}`} replace />

  function select(next: TabId) {
    // Each tab starts clean: filters of another tab do not carry over.
    const p = new URLSearchParams()
    if (TAB_PARAM[next]) p.set('tab', TAB_PARAM[next])
    setParams(p)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.indexOf(tab)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    select(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="leave-tab-${next}"]`)?.focus())
    e.preventDefault()
  }

  return (
    <div className="page lv-page" data-testid="leave-page">
      <PageTitle title="Leave" subtitle="Ask for time off, follow your requests and see who is away." />

      <div className="lv-toolbar">
        <div className="lv-tabs" role="tablist" aria-label="Leave sections" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`lv-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="lv-panel"
              tabIndex={tab === t ? 0 : -1}
              className={`lv-tab${tab === t ? ' active' : ''}`}
              data-testid={`leave-tab-${t}`}
              onClick={() => select(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <Link to="/leave/new" className="btn btn-primary" data-testid="leave-new-link">
          <Plus size={16} aria-hidden="true" /> New leave request
        </Link>
      </div>

      <div id="lv-panel" role="tabpanel" aria-labelledby={`lv-tab-${tab}`} className="lv-panel">
        {tab === 'my' ? <MyLeaveTab currentYear={year} /> : null}
        {tab === 'approvals' ? <ApprovalsTab scopes={scopes} currentYear={year} /> : null}
        {tab === 'calendar' ? <TeamCalendarTab today={today} /> : null}
        {tab === 'settings' ? <SettingsTab year={year} /> : null}
      </div>
    </div>
  )
}
