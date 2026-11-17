import { Navigate } from 'react-router-dom'
import type { ModuleRoute } from '../registry'
import { KnowledgeBasePage } from './KnowledgeBasePage'

/**
 * Bluedge Orbit. The chat itself is the floating widget mounted once in the app shell (see shell/AppShell.tsx), so this module adds the
 * HR Knowledge Base page (sidebar item "Knowledge Base", shown to HR personnel). The server answers 403 to anyone else and the page then
 * says it is not available. The older /settings/knowledge-base address redirects to the new one.
 */
const routes: ModuleRoute[] = [
  { path: 'knowledge-base', element: <KnowledgeBasePage /> },
  { path: 'settings/knowledge-base', element: <Navigate to="/knowledge-base" replace /> },
]

export default routes
