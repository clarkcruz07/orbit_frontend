/** Sidebar navigation, in the exact order of the reference (SPEC section 8). Pure data so it can be unit tested. */

export type NavIconKey =
  | 'home'
  | 'hr-admin'
  | 'profile'
  | 'leave'
  | 'attendance'
  | 'performance'
  | 'learning'
  | 'requests'
  | 'documents'
  | 'calendar'
  | 'settings'
  | 'reimbursements'
  | 'knowledge'

export interface NavItem {
  id: string
  label: string
  path: string
  icon: NavIconKey
  /** Active only on the exact path (HR Requests must not light up for /reimbursements). */
  end?: boolean
  /** Indented sub-item under the previous entry. */
  sub?: boolean
  /** A thin divider is drawn above this item. */
  dividerBefore?: boolean
  /** Shown only to this dashboard view (HR personnel). Not a permission: the page itself is open to anyone who types the URL. */
  onlyView?: 'hr'
}

export const NAV_ITEMS: readonly NavItem[] = [
  // One Dashboard entry for everyone: HR personnel get the HR dashboard at "/", non-HR personnel the personal home.
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'home', end: true },
  // Testing aid for the owner: HR personnel can also open the non-HR (personal) dashboard.
  { id: 'dashboard-standard', label: 'Dashboard', path: '/my-dashboard', icon: 'home', sub: true, onlyView: 'hr' },
  { id: 'my-profile', label: 'My Profile', path: '/my-profile', icon: 'profile' },
  { id: 'leave', label: 'Leave', path: '/leave', icon: 'leave' },
  { id: 'attendance', label: 'Attendance & Timesheet', path: '/attendance', icon: 'attendance' },
  { id: 'performance', label: 'Performance & Check-ins', path: '/performance', icon: 'performance' },
  { id: 'learning', label: 'Learning & Development', path: '/learning', icon: 'learning' },
  { id: 'hr-requests', label: 'HR Requests', path: '/hr-requests', icon: 'requests', end: true },
  { id: 'reimbursements', label: 'Reimbursements', path: '/reimbursements', icon: 'reimbursements', sub: true },
  { id: 'documents', label: 'Documents', path: '/documents', icon: 'documents' },
  // What the Bluedge Orbit assistant knows. HR personnel manage it; the page itself says "not available" to anyone else.
  { id: 'knowledge-base', label: 'Knowledge Base', path: '/knowledge-base', icon: 'knowledge', onlyView: 'hr' },
  { id: 'company-calendar', label: 'Company Calendar', path: '/company-calendar', icon: 'calendar' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings', dividerBefore: true },
]

/** The entries a given dashboard view is offered. */
export function navItemsFor(view: 'hr' | 'standard'): readonly NavItem[] {
  return NAV_ITEMS.filter((i) => !i.onlyView || i.onlyView === view)
}

/** Titles used by the header/placeholder pages. */
export function pageTitleFor(pathname: string): string {
  const exact = NAV_ITEMS.find((i) => i.path === pathname)
  if (exact) return exact.label
  const prefix = NAV_ITEMS.filter((i) => i.path !== '/' && pathname.startsWith(i.path + '/')).sort(
    (a, b) => b.path.length - a.path.length,
  )[0]
  return prefix ? prefix.label : 'Bluedge People'
}
