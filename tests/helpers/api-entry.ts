// Test-only entry: bundles the reimbursements API module together with the SAME axios instance and store it uses,
// so a test can swap the adapter and inspect the exact requests the module builds.
export * from '../../src/api/reimbursements'
export { api } from '../../src/api/client'
export { useAuthStore } from '../../src/stores/authStore'
