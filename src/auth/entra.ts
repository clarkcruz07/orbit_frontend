/**
 * Microsoft sign-in. `@azure/msal-browser` is imported lazily and ONLY when VITE_ENTRA_CLIENT_ID is set.
 * With it blank (the local build) nothing here ever runs and no tenant is contacted.
 */
export const entraClientId: string = (import.meta.env.VITE_ENTRA_CLIENT_ID ?? '').trim()
export const entraConfigured: boolean = entraClientId.length > 0

export const ENTRA_NOT_CONFIGURED_MESSAGE = "Microsoft sign-in isn't configured in this local build."

export async function entraLoginPopup(): Promise<{ idToken: string; graphToken: string | null }> {
  if (!entraConfigured) throw new Error(ENTRA_NOT_CONFIGURED_MESSAGE)
  const { PublicClientApplication } = await import('@azure/msal-browser')
  const authority = (import.meta.env.VITE_ENTRA_AUTHORITY ?? '').trim()
  // The popup must return to a static page that runs no app code and never redirects (the app itself redirects to /login and would wipe the
  // sign-in result, giving MSAL's hash_empty_error). Register this exact URL as a Single-page application redirect URI.
  const redirectUri = (import.meta.env.VITE_ENTRA_REDIRECT_URI ?? '').trim() || `${window.location.origin}/auth-redirect.html`
  const instance = new PublicClientApplication({
    auth: { clientId: entraClientId, ...(authority ? { authority } : {}), redirectUri },
    cache: { cacheLocation: 'sessionStorage' },
  })
  await instance.initialize()
  const result = await instance.loginPopup({ scopes: ['openid', 'profile', 'email', 'User.Read'] })
  if (!result.idToken) throw new Error('Microsoft did not return an identity token.')
  // The same sign-in also grants User.Read, so the backend can read the directory profile (job title, department, manager, ...) from Graph.
  return { idToken: result.idToken, graphToken: result.accessToken || null }
}
