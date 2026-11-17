/**
 * Leave module routes (auto-discovered by modules/registry.ts). Paths are relative to the app shell.
 * `leave/new` is listed before `leave/:id`; the router ranks the static path higher either way.
 */
import type { ModuleRoute } from '../registry'
import { LeaveDetail } from './LeaveDetail'
import { LeaveNew } from './LeaveNew'
import { LeavePage } from './LeavePage'

const routes: ModuleRoute[] = [
  { path: 'leave', element: <LeavePage /> },
  { path: 'leave/new', element: <LeaveNew /> },
  { path: 'leave/:id', element: <LeaveDetail /> },
]

export default routes
