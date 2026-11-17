import { currentMonthKey } from '@/lib/dates'
import { timesheetApi, type TimesheetConfig } from './api'
import { useLoad } from './hooks'
import { ErrorBlock, LoadingCard } from './parts'
import { ClockCard } from './TodayTab'
import './timesheet.css'

/** The same clock in / out card as Attendance & Timesheet, for the top of both dashboards. It loads its own data. */
export function DashboardClock() {
  const config = useLoad(() => timesheetApi.config(), [], 'Attendance could not be loaded.')
  return (
    <div className="dash-clock" data-testid="dashboard-clock">
      {config.data ? (
        <ClockWithToday config={config.data} />
      ) : config.error ? (
        <ErrorBlock problem={config.error} onRetry={config.reload} what="Attendance" />
      ) : (
        <LoadingCard testId="dash-clock-loading" lines={2} />
      )}
    </div>
  )
}

function ClockWithToday({ config }: { config: TimesheetConfig }) {
  const month = currentMonthKey(new Date(`${config.today}T12:00:00`))
  const data = useLoad(() => timesheetApi.myMonth(month), [month], 'Your attendance for this month could not be loaded.')
  const today = data.data?.days.find((d) => d.is_today) ?? null
  return <ClockCard config={config} today={today} onChanged={data.reload} />
}
