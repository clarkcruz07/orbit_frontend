// Test-only entry: the People management API module with the SAME axios instance and store it uses.
export * from '../src/modules/peoplemgmt/api'
export { api } from '../src/api/client'
export { useAuthStore } from '../src/stores/authStore'
