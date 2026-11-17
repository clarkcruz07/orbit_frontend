import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageTitle } from '@/pages/PageTitle'
import { useAuthStore } from '@/stores/authStore'
import { learningApi, type MySummary } from './api'
import { Catalog } from './Catalog'
import { useLearnConfig } from './hooks'
import { HrTab } from './HrTab'
import { MyLearning } from './MyLearning'
import { Tabs } from './parts'
import { TAB_LABEL, learningTabs, parseTab, type TabId } from './logic'
import { TeamTab } from './TeamTab'
import './learning.css'

export function LearningPage() {
  const roles = useAuthStore((s) => s.user?.roles)
  const offered = useMemo(() => learningTabs(roles), [roles])
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'), offered)
  const cfg = useLearnConfig()
  const [tick, setTick] = useState(0)
  const [mine, setMine] = useState<MySummary | null>(null)

  // The summary also feeds the small "waiting" badges. The My learning tab loads its own copy, which is the call that
  // triggers the due-soon notifications; failing here must never break the page.
  useEffect(() => {
    if (tab === 'mine') return
    let live = true
    learningApi
      .mySummary()
      .then((r) => live && setMine(r.data))
      .catch(() => live && setMine(null))
    return () => {
      live = false
    }
  }, [tab, tick])

  function select(next: TabId) {
    const p = new URLSearchParams()
    if (next !== 'catalog') p.set('tab', next)
    setParams(p, { replace: false })
  }
  const refresh = () => setTick((t) => t + 1)
  const reviewTab: TabId | null = offered.includes('team') ? 'team' : offered.includes('hr') ? 'hr' : null

  const badges: Partial<Record<TabId, number>> = {}
  if (reviewTab) badges[reviewTab] = mine?.awaiting_my_confirmation ?? 0

  return (
    <div className="page ln-page" data-testid="learning-page" data-tab={tab}>
      <PageTitle title="Learning & Development" subtitle="Courses, assignments and your progress." />
      <Tabs
        tabs={offered.map((id) => ({ id, label: TAB_LABEL[id], badge: badges[id] || null }))}
        active={tab}
        onSelect={select}
        label="Learning sections"
        testPrefix="tab"
      />
      <div className="ln-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'catalog' ? <Catalog onChanged={refresh} /> : null}
        {tab === 'mine' ? <MyLearning onOpenReview={reviewTab ? () => select(reviewTab) : undefined} /> : null}
        {tab === 'team' ? <TeamTab onChanged={refresh} /> : null}
        {tab === 'hr' ? <HrTab cfg={cfg} onChanged={refresh} /> : null}
      </div>
    </div>
  )
}
