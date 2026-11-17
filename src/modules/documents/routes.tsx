import type { ModuleRoute } from '../registry'
import { DocumentsPage, DocumentsPolicyRoute } from './DocumentsPage'

/** `documents` replaces the placeholder page; `documents/policies/:policyId` is the `policy.published` notification link. */
const routes: ModuleRoute[] = [
  { path: 'documents', element: <DocumentsPage /> },
  { path: 'documents/policies/:policyId', element: <DocumentsPolicyRoute /> },
]

export default routes
