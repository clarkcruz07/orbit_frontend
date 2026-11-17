import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Clock,
  Folder,
  GraduationCap,
  House,
  Receipt,
  Settings,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { useAuthStore } from '@/stores/authStore'
import { dashboardView } from '@/lib/authLogic'
import { navItemsFor, type NavIconKey } from './navigation'

const ICONS: Record<NavIconKey, LucideIcon> = {
  home: House,
  'hr-admin': UsersRound,
  profile: UserRound,
  leave: CalendarDays,
  attendance: Clock,
  performance: BarChart3,
  learning: GraduationCap,
  requests: ClipboardList,
  reimbursements: Receipt,
  documents: Folder,
  knowledge: BookOpen,
  calendar: CalendarCheck,
  settings: Settings,
}

export function Sidebar({ id }: { id: string }) {
  const view = useAuthStore((s) => dashboardView(s.user))
  return (
    <aside className="sidebar" id={id} aria-label="Primary">
      <div className="sidebar-brand">
        <BrandLogo variant="light" />
      </div>
      <nav className="sidebar-nav">
        <ul>
          {navItemsFor(view).map((item) => {
            const Icon = ICONS[item.icon]
            return (
              <li key={item.id} className={item.dividerBefore ? 'nav-divider-before' : undefined}>
                <NavLink
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) => `nav-link${item.sub ? ' nav-sub' : ''}${isActive ? ' active' : ''}`}
                  data-nav-id={item.id}
                >
                  <Icon size={item.sub ? 20 : 24} strokeWidth={1.6} aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
      <svg className="sidebar-swoosh" viewBox="0 0 266 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="sw-blue" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#1b6fe3" />
            <stop offset="1" stopColor="#0d3f9e" />
          </linearGradient>
        </defs>
        <path d="M0 62 C 70 74, 150 112, 266 190 L 0 190 Z" fill="url(#sw-blue)" opacity="0.95" />
        <path d="M0 42 C 70 52, 150 90, 266 168 L 266 178 C 150 106, 70 66, 0 56 Z" fill="#ffc928" />
        <path d="M0 18 C 56 20, 110 40, 170 72" fill="none" stroke="#2f86f0" strokeWidth="6" strokeLinecap="round" opacity="0.55" />
      </svg>
    </aside>
  )
}
