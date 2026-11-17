import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { hasAnyRole, loginRedirectPath, type Role } from '@/lib/authLogic'
import { restoreSession } from './session'
import { EmptyState } from '@/ui/EmptyState'
import { ShieldAlert, WifiOff } from 'lucide-react'
import '@/ui/ui.css'

/** Wrap routes that need a session. `roles` (optional) additionally restricts by role. */
export function ProtectedRoute({ roles }: { roles?: readonly Role[] }) {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="boot-spinner" aria-hidden="true" />
        <p>Loading your session...</p>
      </div>
    )
  }
  if (status === 'unreachable') {
    return (
      <div className="boot-screen">
        <EmptyState
          icon={<WifiOff size={28} />}
          title="Can't reach the Bluedge People service"
          body="The service did not answer. Check that it is running, then try again."
          action={
            <button type="button" className="btn btn-primary" onClick={() => void restoreSession()}>
              Try again
            </button>
          }
        />
      </div>
    )
  }
  if (status === 'anonymous' || !user) {
    return <Navigate to={loginRedirectPath(location.pathname, location.search, location.hash)} replace />
  }
  if (!hasAnyRole(user, roles)) {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title="You don't have access to this page"
        body="This page is restricted to a role your account does not have."
      />
    )
  }
  return <Outlet />
}
