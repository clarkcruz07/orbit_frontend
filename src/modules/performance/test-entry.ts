// Test-only entry: bundles the performance API together with the SAME axios instance and store it uses, so a unit test
// can swap the adapter and inspect the exact requests the module builds. Not imported by the app.
export * from './api'
export { api } from '@/api/client'
export { useAuthStore } from '@/stores/authStore'
