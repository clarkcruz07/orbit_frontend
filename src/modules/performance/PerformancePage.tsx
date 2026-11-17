import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageTitle } from '@/pages/PageTitle'
import { useAuthStore } from '@/stores/authStore'
import { performanceApi, type PerformanceSummary } from './api'
import { HrOverview } from './HrOverview'
import { usePerfConfig } from './hooks'
import { MyCheckins } from './MyCheckins'
import { MyGoals } from './MyGoals'
import { ProbationTab } from './ProbationTab'
import { Tabs } from './parts'
import { TAB_LABEL, parseTab, performanceTabs, type TabId } from './logic'
import { TeamView } from './TeamView'
import './performance.css'

export function PerformancePage() {
  const roles = useAuthStore((s) => s.user?.roles)
  const offered = useMemo(() => performanceTabs(roles), [roles])
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'), offered)
  const cfg = usePerfConfig()
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)
  const [tick, setTick] = useState(0)

  // The summary only feeds the small "waiting" badges; failing to load it must not break the page.
  useEffect(() => {
    let live = true
    performanceApi
      .summary()
      .then((r) => live && setSummary(r.data))
      .catch(() => live && setSummary(null))
    return () => {
      live = false
    }
  }, [tick])

  function select(next: TabId) {
    const p = new URLSearchParams()
    if (next !== 'goals') p.set('tab', next)
    setParams(p, { replace: false })
  }
  const refresh = () => setTick((t) => t + 1)

  const badges: Partial<Record<TabId, number>> = {
    checkins: summary?.checkins.requested_of_me ?? 0,
    team: summary?.team?.reviews_waiting ?? 0,
  }

  return (
    <div className="page pf-page" data-testid="performance-page" data-tab={tab}>
      <PageTitle title="Performance & Check-ins" subtitle="Goals and check-ins between you and your manager." />
      <Tabs
        tabs={offered.map((id) => ({ id, label: TAB_LABEL[id], badge: badges[id] || null }))}
        active={tab}
        onSelect={select}
        label="Performance sections"
        testPrefix="tab"
      />
      <div className="pf-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'goals' ? <MyGoals limits={cfg.limits} onChanged={refresh} /> : null}
        {tab === 'checkins' ? <MyCheckins limits={cfg.limits} onChanged={refresh} /> : null}
        {tab === 'team' ? <TeamView reviewsWaiting={summary?.team?.reviews_waiting} limits={cfg.limits} onChanged={refresh} /> : null}
        {tab === 'overview' ? <HrOverview hrCanSeeMood={cfg.hrCanSeeMood} /> : null}
        {tab === 'probation' ? <ProbationTab /> : null}
      </div>
    </div>
  )
}
