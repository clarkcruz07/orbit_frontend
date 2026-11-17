import type { ModuleRoute } from '../registry'
import { AttendancePage } from './AttendancePage'

/** Mounted by the module registry in place of the earlier placeholder Attendance page. */
const routes: ModuleRoute[] = [{ path: 'attendance', element: <AttendancePage /> }]
export default routes
