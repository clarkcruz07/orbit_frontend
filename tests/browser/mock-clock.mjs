// The three routes behind the clock card that sits on top of both dashboards (GET /timesheet/config, /attendance/status,
// /attendance/me). Shared by the small mocks that serve Home or the HR dashboard. The person is never clocked in.
export const CLOCK_NOW = '2026-11-16T02:00:00.000+00:00' // Mon 16 Nov 2026, 10:00 in Manila
export const CLOCK_TODAY = '2026-11-16'

export function handleClock({ route, method, user, send }) {
  if (method !== 'GET') return false
  if (route === '/timesheet/config') {
    if (!user) return send(401, { detail: 'Not authenticated' })
    return send(200, { timezone: 'Asia/Manila', now: CLOCK_NOW, today: CLOCK_TODAY, current_week_start: '2026-11-16', max_session_hours: 16, max_hours_per_day: 24, hour_step: 0.25, max_rows: 20, correction_window_days: 60, notice: '' })
  }
  if (route === '/attendance/status') {
    if (!user) return send(401, { detail: 'Not authenticated' })
    return send(200, { now: CLOCK_NOW, today: CLOCK_TODAY, timezone: 'Asia/Manila', open_session: null, needs_correction: false, max_session_hours: 16, allowed_actions: ['clock_in'] })
  }
  if (route === '/attendance/me') {
    if (!user) return send(401, { detail: 'Not authenticated' })
    return send(200, { employee: { employee_id: user.employee_id, name: user.name }, month: CLOCK_TODAY.slice(0, 7), timezone: 'Asia/Manila', today: CLOCK_TODAY, days: [], totals: { hours: 0, days_worked: 0, needs_correction_days: 0 } })
  }
  return false
}
