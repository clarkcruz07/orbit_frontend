/** Performance & Check-ins: mounted automatically by modules/registry.ts (replaces the "coming soon" page). */
import type { ModuleRoute } from '../registry'
import { CheckinDetail } from './CheckinDetail'
import { GoalDetail } from './GoalDetail'
import { PerformancePage } from './PerformancePage'
import { ProbationDetail } from './ProbationDetail'

const routes: ModuleRoute[] = [
  { path: 'performance', element: <PerformancePage /> },
  { path: 'performance/goals/:id', element: <GoalDetail /> },
  { path: 'performance/checkins/:id', element: <CheckinDetail /> },
  { path: 'performance/probation/:id', element: <ProbationDetail /> },
]

export default routes
