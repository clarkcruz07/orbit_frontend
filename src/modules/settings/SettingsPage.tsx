import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '@/ui/Feedback'
import { PageTitle } from '@/pages/PageTitle'
import { useAuthStore } from '@/stores/authStore'
import { settingsApi, type HrSettings } from './api'
import { AccountTab } from './AccountTab'
import { CatalogsTab } from './CatalogsTab'
import { HrSettingsTab } from './HrSettingsTab'
import { PreferencesTab } from './PreferencesTab'
import { UsersTab } from './UsersTab'
import { RowsSkeleton } from './parts'
import { TAB_LABEL, TAB_PARAM, availableTabs, hrAccessFromError, parseTab, type HrAccess, type TabId } from './logic'
import '@/pages/pages.css'
import './settings.css'

/**
 * A 403 from `GET /settings` is remembered (for this user, until the page is reloaded) so that someone who is not allowed
 * does not trigger a refused request (and an `access.denied` audit event) every time they open Settings.
 */
let deniedFor: string | null = null

/**
 * Settings. Everyone gets "My preferences" and "Account". The HR tabs are offered only when the SERVER says so: `GET /settings`
 * answers 200 for HR administrators and 403 for everyone else. No role name decides anything here, and every HR call is
 * authorised by the server again.
 */
export function SettingsPage() {
  const userId = useAuthStore((s) => s.user?.user_id ?? null)
  const [params, setParams] = useSearchParams()
  const [access, setAccess] = useState<HrAccess>(userId && deniedFor === userId ? 'denied' : 'checking')
  const [hr, setHr] = useState<HrSettings | null>(null)

  const probe = useCallback(() => {
    setAccess('checking')
    settingsApi
      .settings()
      .then((s) => {
        setHr(s)
        setAccess('allowed')
      })
      .catch((err) => {
        const next = hrAccessFromError(err)
        if (next === 'denied') deniedFor = userId
        setAccess(next)
      })
  }, [userId])

  useEffect(() => {
    if (access === 'checking') probe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tabs = useMemo(() => availableTabs(access), [access])
  const tab = parseTab(params.get('tab'), tabs, access)

  // A link to an HR tab for someone the server turned away: drop the parameter so the URL matches what is shown.
  useEffect(() => {
    const raw = params.get('tab')
    if (raw && access !== 'checking' && TAB_PARAM[tab] !== raw) setParams(new URLSearchParams(), { replace: true })
  }, [access, tab, params, setParams])

  function select(next: TabId) {
    const p = new URLSearchParams()
    if (TAB_PARAM[next]) p.set('tab', TAB_PARAM[next])
    setParams(p)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.indexOf(tab)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    select(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="settings-tab-${next}"]`)?.focus())
    e.preventDefault()
  }

  const hrTab = tab === 'hr' || tab === 'users' || tab === 'catalogs'

  return (
    <div className="page st-page" data-testid="settings-page" data-tab={tab}>
      <PageTitle title="Settings" subtitle="Your notification preferences, your account and, for HR administrators, the data settings." />

      <div className="st-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onKeyDown} data-testid="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`st-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="st-panel"
            tabIndex={tab === t ? 0 : -1}
            className={`st-tab${tab === t ? ' active' : ''}`}
            data-testid={`settings-tab-${t}`}
            onClick={() => select(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
        {access === 'checking' && !hrTab ? <span className="st-checking" role="status">Checking HR access...</span> : null}
      </div>

      {access === 'error' ? (
        <div className="st-feedback-error" data-testid="settings-probe-error">
          <Alert tone="warning">
            We couldn&apos;t check whether HR settings are available to your account.{' '}
            <button type="button" className="st-link-button" onClick={probe}>
              Try again
            </button>
          </Alert>
        </div>
      ) : null}

      <div id="st-panel" role="tabpanel" aria-labelledby={`st-tab-${tab}`} className="st-panel-wrap">
        {tab === 'preferences' ? <PreferencesTab /> : null}
        {tab === 'account' ? <AccountTab hrAccess={access} /> : null}
        {hrTab && access === 'checking' ? <RowsSkeleton rows={3} height={90} /> : null}
        {tab === 'hr' && access === 'allowed' && hr ? <HrSettingsTab settings={hr} onSettings={setHr} /> : null}
        {tab === 'users' && access === 'allowed' ? <UsersTab /> : null}
        {tab === 'catalogs' && access === 'allowed' ? <CatalogsTab /> : null}
      </div>
    </div>
  )
}
