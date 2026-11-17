import { createElement } from 'react'
import {
  BarChart3,
  CalendarDays,
  Clock,
  Folder,
  GraduationCap,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from './PageTitle'
import './pages.css'

/** Every not-yet-built module renders through this one shared page: honest, no fake actions. */
export function ComingSoon({ title, subtitle, body, icon }: { title: string; subtitle: string; body: string; icon: LucideIcon }) {
  return (
    <div className="page">
      <PageTitle title={title} subtitle={subtitle} />
      <EmptyState badge="Coming soon" icon={createElement(icon, { size: 28 })} title={`${title} is coming soon`} body={body} />
    </div>
  )
}

export const LeavePage = () => (
  <ComingSoon title="Leave" subtitle="Time off requests and balances." icon={CalendarDays} body="This module has not been built yet. It will show leave balances and requests once it is available." />
)
export const AttendancePage = () => (
  <ComingSoon title="Attendance & Timesheet" subtitle="Time tracking and timesheets." icon={Clock} body="This module has not been built yet. It will cover attendance and timesheets once it is available." />
)
export const PerformancePage = () => (
  <ComingSoon title="Performance & Check-ins" subtitle="Goals, reviews and one-to-ones." icon={BarChart3} body="This module has not been built yet. It will hold goals and check-ins once it is available." />
)
export const LearningPage = () => (
  <ComingSoon title="Learning & Development" subtitle="Courses and development plans." icon={GraduationCap} body="This module has not been built yet. It will list learning and development once it is available." />
)
export const DocumentsPage = () => (
  <ComingSoon title="Documents" subtitle="Company and personal documents." icon={Folder} body="This module has not been built yet. It will store and share documents once it is available." />
)
export const SettingsPage = () => (
  <ComingSoon title="Settings" subtitle="Preferences for your account." icon={Settings} body="This module has not been built yet. It will hold account and workspace settings once it is available." />
)
