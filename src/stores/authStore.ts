import { create } from 'zustand'
import type { SessionUser } from '@/lib/authLogic'

export const ACCESS_KEY = 'people.accessToken'
export const REFRESH_KEY = 'people.refreshToken'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    /* storage unavailable: the session just lasts for this tab */
  }
}

/** loading: restoring via /auth/me; unreachable: API did not answer (retry screen). */
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

interface AuthState {
  user: SessionUser | null
  accessToken: string | null
  refreshToken: string | null
  status: SessionStatus
  setTokens: (access: string | null, refresh?: string | null) => void
  setUser: (user: SessionUser) => void
  setStatus: (status: SessionStatus) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: read(ACCESS_KEY),
  refreshToken: read(REFRESH_KEY),
  status: read(ACCESS_KEY) ? 'loading' : 'anonymous',
  setTokens: (access, refresh) => {
    write(ACCESS_KEY, access)
    const nextRefresh = refresh === undefined ? get().refreshToken : refresh
    write(REFRESH_KEY, nextRefresh)
    set({ accessToken: access, refreshToken: nextRefresh })
  },
  setUser: (user) => set({ user, status: 'authenticated' }),
  setStatus: (status) => set({ status }),
  clear: () => {
    write(ACCESS_KEY, null)
    write(REFRESH_KEY, null)
    set({ user: null, accessToken: null, refreshToken: null, status: 'anonymous' })
  },
}))
