import type { ModuleRoute } from '../registry'
import { SettingsPage } from './SettingsPage'

/** Mounted by the module registry in place of the "coming soon" Settings page. */
const routes: ModuleRoute[] = [{ path: 'settings', element: <SettingsPage /> }]
export default routes
