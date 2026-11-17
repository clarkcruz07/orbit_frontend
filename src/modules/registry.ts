/**
 * Auto-discovery of HR module pages. A module adds `src/modules/<name>/routes.tsx` that default-exports an array of
 * `{ path, element }` (paths relative to the app shell, e.g. 'leave', 'leave/new', 'leave/:id'). App.tsx mounts every discovered route and
 * drops the matching "coming soon" placeholder, so modules can be built in parallel without editing any shared file.
 */
import type { ReactElement } from 'react'

export interface ModuleRoute {
  path: string
  element: ReactElement
}

const found = import.meta.glob('./*/routes.tsx', { eager: true }) as Record<string, { default?: ModuleRoute[] }>

export function discoverModuleRoutes(): ModuleRoute[] {
  const all: ModuleRoute[] = []
  for (const key of Object.keys(found).sort()) {
    const routes = found[key]?.default
    if (Array.isArray(routes)) all.push(...routes)
  }
  return all
}
