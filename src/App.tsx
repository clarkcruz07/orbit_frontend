import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { restoreSession } from '@/auth/session'
import { dashboardView } from '@/lib/authLogic'
import { AppShell } from '@/shell/AppShell'
import { Login } from '@/pages/Login'
import { Home } from '@/pages/Home'
import { HrAdministration } from '@/pages/hr/HrAdministration'
import { MyProfile } from '@/pages/MyProfile'
import { HrRequests } from '@/pages/HrRequests'
import { NotFound } from '@/pages/NotFound'
import { DirectoryList } from '@/pages/directory/DirectoryList'
import { DirectoryProfile } from '@/pages/directory/DirectoryProfile'
import { CompanyCalendar } from '@/pages/calendar/CompanyCalendar'
import {
  AttendancePage,
  DocumentsPage,
  LeavePage,
  LearningPage,
  PerformancePage,
  SettingsPage,
} from '@/pages/ComingSoon'
import { ReimbursementDetail, ReimbursementNew, ReimbursementsList } from '@/pages/reimbursements'
import { useAuthStore } from '@/stores/authStore'
import { discoverModuleRoutes } from '@/modules/registry'

const MODULE_ROUTES = discoverModuleRoutes()
const PROVIDED = new Set(MODULE_ROUTES.map((r) => r.path))
/** A placeholder route is mounted only while no real module provides the same path. */
const placeholder = (path: string, element: JSX.Element) => (PROVIDED.has(path) ? null : <Route path={path} element={element} />)

/** Testing aid: the owner (HR personnel) can open the non-HR dashboard too. Everyone else is sent to their own Dashboard. */
function MyDashboard() {
  const user = useAuthStore((s) => s.user)
  return dashboardView(user) === 'hr' ? <Home /> : <Navigate to="/" replace />
}

/** HR personnel (Entra employeeType -> HRAdmin) see the HR dashboard; non-HR personnel see their personal home. */
function Dashboard() {
  const user = useAuthStore((s) => s.user)
  return dashboardView(user) === 'hr' ? <HrAdministration /> : <Home />
}

export default function App() {
  useEffect(() => {
    if (useAuthStore.getState().status === 'loading') void restoreSession()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="my-dashboard" element={<MyDashboard />} />
            {MODULE_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            {/* The HR dashboard now lives at the Dashboard ("/"); keep the old address working. */}
            <Route path="hr-administration" element={<Navigate to="/" replace />} />
            <Route path="my-profile" element={<MyProfile />} />
            <Route path="profile" element={<Navigate to="/my-profile" replace />} />
            <Route path="directory" element={<DirectoryList />} />
            <Route path="directory/:employeeId" element={<DirectoryProfile />} />
            {placeholder("leave", <LeavePage />)}
            {placeholder("attendance", <AttendancePage />)}
            {placeholder("performance", <PerformancePage />)}
            {placeholder("learning", <LearningPage />)}
            {placeholder("hr-requests", <HrRequests />)}
            <Route path="reimbursements" element={<ReimbursementsList />} />
            <Route path="reimbursements/new" element={<ReimbursementNew />} />
            <Route path="reimbursements/:id" element={<ReimbursementDetail />} />
            {placeholder("documents", <DocumentsPage />)}
            <Route path="company-calendar" element={<CompanyCalendar />} />
            <Route path="calendar" element={<Navigate to="/company-calendar" replace />} />
            {placeholder("settings", <SettingsPage />)}
            <Route path="home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
