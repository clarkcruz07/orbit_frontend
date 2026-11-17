/** Learning & Development: mounted automatically by modules/registry.ts (replaces the "coming soon" page). */
import type { ModuleRoute } from '../registry'
import { EnrolmentDetail } from './EnrolmentDetail'
import { LearningPage } from './LearningPage'

const routes: ModuleRoute[] = [
  { path: 'learning', element: <LearningPage /> },
  { path: 'learning/enrolments/:id', element: <EnrolmentDetail /> },
]

export default routes
