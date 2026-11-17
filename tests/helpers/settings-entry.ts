// Test-only entry: the Settings API module, its pure logic and the live dashboard formatting, bundled together with the SAME
// axios instance and auth store the app uses (so a stub adapter on `api` intercepts the real calls).
export * from '../../src/modules/settings/api'
export * from '../../src/modules/settings/logic'
export * from '../../src/lib/dashboardFormat'
export { api } from '../../src/api/client'
export { useAuthStore } from '../../src/stores/authStore'
