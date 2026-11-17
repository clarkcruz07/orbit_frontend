// Test-only entry: the new addendum-2 API modules plus the SAME axios instance and store they use.
export * from '../../src/api/directory'
export { meApi, normaliseMyProfile } from '../../src/api/me'
export { calendarApi, normaliseMonth, normaliseUpcoming, normaliseEvent } from '../../src/api/calendar'
export { notificationsApi, normaliseNotifications } from '../../src/api/notifications'
export { searchApi, normaliseSearch } from '../../src/api/search'
export { api } from '../../src/api/client'
export { useAuthStore } from '../../src/stores/authStore'
