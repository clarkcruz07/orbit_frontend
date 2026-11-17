import { api } from './client'
import type { SessionUser } from '@/lib/authLogic'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  user: SessionUser
}

export interface AuthConfig {
  demo_auth: boolean
  entra_configured: boolean
  /** false: the server has the e-mail + password sign-in switched off (Microsoft only). Absent means on. */
  password_login?: boolean
}

export const authApi = {
  login: (email: string, password: string) => api.post<LoginResponse>('/auth/login', { email, password }),
  entraLogin: (idToken: string, graphToken?: string | null) =>
    api.post<LoginResponse>('/auth/entra', { id_token: idToken, ...(graphToken ? { graph_token: graphToken } : {}) }),
  me: () => api.get<SessionUser>('/auth/me'),
  config: () => api.get<AuthConfig>('/auth/config'),
  logout: () => api.post('/auth/logout'),
}
