import { authApi } from '@/api/auth'
import { classifyMeFailure } from '@/lib/authLogic'
import { useAuthStore } from '@/stores/authStore'

/** Restore the session from stored tokens via GET /auth/me. Retry screen when the API is unreachable. */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState()
  if (!store.accessToken) {
    store.setStatus('anonymous')
    return
  }
  store.setStatus('loading')
  try {
    const res = await authApi.me()
    useAuthStore.getState().setUser(res.data)
  } catch (err) {
    if (classifyMeFailure(err as { response?: { status?: number } }) === 'unauthorized') {
      useAuthStore.getState().clear()
    } else {
      useAuthStore.getState().setStatus('unreachable')
    }
  }
}

export async function signOut(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    /* audit-only endpoint; the local session ends regardless */
  }
  useAuthStore.getState().clear()
}
