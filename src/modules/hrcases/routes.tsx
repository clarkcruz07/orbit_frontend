import type { ModuleRoute } from '../registry'
import { CaseDetail } from './CaseDetail'
import { HrRequestsLanding } from './HrRequestsLanding'
import { NewCase } from './NewCase'

/** `hr-requests` replaces the old card grid; `hr-requests/cases/:id` is the case notification deep link. */
const routes: ModuleRoute[] = [
  { path: 'hr-requests', element: <HrRequestsLanding /> },
  { path: 'hr-requests/new', element: <NewCase /> },
  { path: 'hr-requests/cases/:id', element: <CaseDetail /> },
]

export default routes
