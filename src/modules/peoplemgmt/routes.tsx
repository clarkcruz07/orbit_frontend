import type { ModuleRoute } from '../registry'
import { HolidaysPage } from './HolidaysPage'
import { ImportPage } from './ImportPage'
import { PeopleList } from './PeopleList'
import { Profile201Page } from './Profile201Page'
import { PersonDetail } from './PersonDetail'
import { PersonNew } from './PersonNew'

/**
 * People management (HR) and Holidays admin. There is no sidebar entry: HR reaches these pages from Settings (Catalogs and
 * Users and roles tabs). The server answers 403 to anyone else and each page then says it is not available.
 * `people/new` and `people/import` are fixed paths, so they win over `people/:employeeId`.
 */
const routes: ModuleRoute[] = [
  { path: 'people', element: <PeopleList /> },
  { path: 'people/new', element: <PersonNew /> },
  { path: 'people/import', element: <ImportPage /> },
  { path: 'people/import-201', element: <Profile201Page /> },
  { path: 'people/:employeeId', element: <PersonDetail /> },
  { path: 'settings/holidays', element: <HolidaysPage /> },
]

export default routes
