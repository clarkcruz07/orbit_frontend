import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { isAuthEndpoint, loginRedirectPath, shouldAttemptRefresh } from '@/lib/authLogic'

/** All calls go to `/api/...`; Vite (dev) or the harness proxies and strips the prefix. */
export const api = axios.create({ baseURL: '/api', timeout: 20000 })

type Retriable = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

/** Exactly one refresh in flight; concurrent 401s wait for the same promise. */
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refresh = useAuthStore.getState().refreshToken
  if (!refresh) return null
  try {
    // Plain axios (no interceptors) so a failing refresh can never recurse.
    const res = await axios.post<{ access_token: string }>('/api/auth/refresh', { refresh_token: refresh }, { timeout: 15000 })
    const token = res.data?.access_token
    if (!token) return null
    useAuthStore.getState().setTokens(token)
    return token
  } catch {
    return null
  }
}

export function forceLogout(): void {
  useAuthStore.getState().clear()
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const { pathname, search, hash } = window.location
    window.location.replace(loginRedirectPath(pathname, search, hash))
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as Retriable | undefined
    if (error.response?.status === 401 && original && !isAuthEndpoint(original.url)) {
      const hasRefresh = Boolean(useAuthStore.getState().refreshToken)
      if (shouldAttemptRefresh({ status: 401, url: original.url, alreadyRetried: Boolean(original._retried), hasRefreshToken: hasRefresh })) {
        original._retried = true
        refreshing = refreshing ?? refreshAccessToken().finally(() => (refreshing = null))
        const token = await refreshing
        if (token) {
          original.headers.set('Authorization', `Bearer ${token}`)
          return api(original)
        }
      }
      // Refresh failed, was already tried once, or there is nothing to refresh with: the session is over.
      forceLogout()
    }
    return Promise.reject(error)
  },
)
