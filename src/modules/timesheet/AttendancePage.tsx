import { useSearchParams } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from '@/pages/PageTitle'
import { timesheetApi } from './api'
import { ApprovalsTab } from './ApprovalsTab'
import { CorrectionsTab } from './CorrectionsTab'
import { HrTab } from './HrTab'
import { useLoad } from './hooks'
import { ALL_TABS, TAB_LABEL, availableTabs, parseTab, type TabId } from './logic'
import { LoadingCard } from './parts'
import { TeamTab } from './TeamTab'
import { TimesheetTab } from './TimesheetTab'
import { TodayTab } from './TodayTab'
import './timesheet.css'
import '@/pages/pages.css'

/** Attendance & Timesheet: tabs synced to `?tab=` (the notification deep links land on `timesheet` and `corrections`). */
export function AttendancePage() {
  const roles = useAuthStore((s) => s.user?.roles)
  const [params, setParams] = useSearchParams()
  const config = useLoad(() => timesheetApi.config(), [], 'Attendance could not be loaded.')
  const codes = useLoad(() => timesheetApi.codes(false), [], 'The timesheet codes could not be loaded.')

  const requested = parseTab(params.get('tab'))
  const canManageCodes = Boolean(codes.data?.can_manage)
  const offered = availableTabs(roles, canManageCodes)
  // A deep link to a tab that is not offered (for example an HR link while the catalog flag is still loading) keeps its tab:
  // the server answers 403/404 and the tab says "not available". Only an unknown value falls back to the first tab.
  const tab: TabId = requested
  const shown = (ALL_TABS as readonly TabId[]).filter((t) => offered.includes(t) || t === tab)

  function choose(next: TabId) {
    const p = new URLSearchParams()
    if (next !== 'today') p.set('tab', next)
    setParams(p, { replace: false })
  }

  const cfg = config.data

  return (
    <div className="page ts-page" data-testid="attendance-page">
      <PageTitle title="Attendance & Timesheet" subtitle="Clock in and out, fix a missed punch, and keep your weekly timesheet." />

      {config.error && !cfg ? (
        <EmptyState
          icon={<Clock size={28} />}
          title="Attendance could not be loaded"
          body={config.error.detail}
          action={
            <button type="button" className="btn btn-primary" onClick={config.reload} data-testid="config-retry">
              Try again
            </button>
          }
        />
      ) : !cfg ? (
        <LoadingCard testId="page-loading" lines={3} />
      ) : (
        <>
          <div className="ts-tabs" role="tablist" aria-label="Attendance and timesheet sections" data-testid="ts-tabs">
            {shown.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls="ts-panel"
                className={`ts-tab${tab === t ? ' active' : ''}`}
                onClick={() => choose(t)}
                data-testid={`tab-btn-${t}`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          <div id="ts-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'today' ? <TodayTab config={cfg} /> : null}
            {tab === 'timesheet' ? <TimesheetTab config={cfg} codes={codes.data?.items ?? []} /> : null}
            {tab === 'corrections' ? <CorrectionsTab config={cfg} /> : null}
            {tab === 'approvals' ? <ApprovalsTab timezone={cfg.timezone} /> : null}
            {tab === 'team' ? <TeamTab config={cfg} /> : null}
            {tab === 'hr' ? <HrTab config={cfg} onCodesChanged={codes.reload} /> : null}
          </div>
        </>
      )}
    </div>
  )
}
