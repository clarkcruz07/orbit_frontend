import { useCallback, useEffect, useState } from 'react'
import {
  CircleCheck,
  Clock,
  FileText,
  Headset,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
  Briefcase,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react'
import { dashboardApi } from '@/api/dashboard'
import { Donut } from '@/components/Donut'
import { EmptyState } from '@/ui/EmptyState'
import { Alert, Skeleton } from '@/ui/Feedback'
import {
  clampPct,
  degradedNames,
  directoryRows,
  expiringLabel,
  formatDelta,
  formatInt,
  formatPct,
  lifecycleRows,
  normaliseDashboard,
  periodLabel,
  resolutionDays,
  statusLabel,
  unavailableReason,
  unavailableTitle,
  type DashboardModel,
} from '@/lib/dashboardFormat'
import { DashboardClock } from '@/modules/timesheet/DashboardClock'
import { useAuthStore } from '@/stores/authStore'
import { HeadcountChart } from './HeadcountChart'
import { CardHeader, HrSwoosh, MutedAction, NotAvailable, Pill, SummaryCard, UpcomingCard } from './parts'
import '@/ui/ui.css'
import './hr-admin.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DashboardModel }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

export function HrAdministration() {
  const user = useAuthStore((s) => s.user)
  const first = (user?.name ?? '').split(/\s+/)[0] || 'there'
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(() => {
    setState({ kind: 'loading' })
    return dashboardApi
      .hrDashboard()
      .then((res) => setState({ kind: 'ready', data: normaliseDashboard(res.data) }))
      .catch((err: { response?: { status?: number } }) => {
        const status = err?.response?.status
        if (status === 403) setState({ kind: 'forbidden' })
        else if (status === 401) setState({ kind: 'error', message: 'Your session has ended. Please sign in again.' })
        else if (!status) setState({ kind: 'error', message: "Can't reach the Bluedge People service." })
        else setState({ kind: 'error', message: 'The dashboard could not be loaded.' })
      })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="hr-page">
      <HrSwoosh />
      <div className="hr-title-block">
        <div className="hr-eyebrow-row">
          <span className="hr-eyebrow">BLUEDGE PEOPLE</span>
        </div>
        <h1>{`Welcome, ${first}`}</h1>
        <p>Your personal home in Bluedge People.</p>
      </div>

      <DashboardClock />

      {state.kind === 'loading' ? <DashboardSkeleton /> : null}
      {state.kind === 'forbidden' ? (
        <EmptyState
          icon={<ShieldAlert size={28} />}
          title="This page is restricted to HR Administrators"
          body="Your account does not have the HR Administrator role. If you think you should have access, ask your HR team."
        />
      ) : null}
      {state.kind === 'error' ? (
        <div className="hr-error" data-testid="dashboard-error">
          <Alert tone="danger">{state.message}</Alert>
          <button type="button" className="btn btn-secondary" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? <Dashboard data={state.data} /> : null}
    </div>
  )
}

/* ---------------- sections ---------------- */

function Dashboard({ data }: { data: DashboardModel }) {
  const failed = data.unavailable_blocks
  const trendFailed = failed.includes('headcount_trend')
  return (
    <>
      {failed.length > 0 ? (
        <div className="hr-degraded" data-testid="degraded-note">
          <Alert tone="warning">Some blocks could not be computed just now ({degradedNames(failed)}). The rest of the dashboard is up to date.</Alert>
        </div>
      ) : null}
      <SummaryCards data={data} />
      <div className="hr-grid">
        <div className="hr-left">
          <section className="hr-card hr-trend" aria-labelledby="h-trend" data-testid="card-headcount-trend">
            <CardHeader icon={Users} title="Headcount Trend" subtitle="Synced accounts minus Users and roles, by year" action="View Details" id="h-trend" />
            {data.headcount_trend.length > 0 ? (
              <HeadcountChart data={data.headcount_trend} />
            ) : (
              <NotAvailable
                title={trendFailed ? 'Temporarily unavailable' : 'No trend yet'}
                reason={trendFailed ? 'This block could not be computed just now.' : 'There are no head count points to chart yet.'}
                minHeight={162}
                testId="trend-empty"
              />
            )}
          </section>

          <LifecycleCard
            id="onb"
            testId="card-onboarding"
            icon={UserPlus}
            title="Onboarding Progress"
            subtitle="New hires in the onboarding process"
            action="View All"
            block={data.onboarding}
            centerLabel="Onboarding Completed"
            size={142}
            stroke={16}
          />

          <LifecycleCard
            id="offb"
            testId="card-offboarding"
            icon={UserMinus}
            title="Offboarding Progress"
            subtitle="Employees in the offboarding process"
            action="View All"
            block={data.offboarding}
            centerLabel="Offboarding Completed"
            size={132}
            stroke={16}
          />

          <DirectoryCard directory={data.directory} />

          <CasesCard cases={data.hr_cases} />

          {data.microsoft_accounts ? <AccountsCard accounts={data.microsoft_accounts} /> : null}
        </div>

        <UpcomingCard birthdays={data.birthdays} holidays={data.holidays} failed={failed} />
      </div>
    </>
  )
}





function NoDelta({ text = 'No comparison yet' }: { text?: string }) {
  return <span className="delta-none">{text}</span>
}

function SummaryCards({ data }: { data: DashboardModel }) {
  const s = data.summary
  const headDelta = formatDelta(s.headcount.delta_pct, '%')
  const policyDelta = formatDelta(s.policy_acknowledgement.delta_pp, 'pp')
  return (
    <div className="summary-row" data-testid="summary-cards">
      <SummaryCard icon={UsersRound} tint="blue" title="Total Headcount" value={formatInt(s.headcount.value)} testId="sum-headcount" na={s.headcount}>
        {s.headcount.delta_pct === null ? <NoDelta /> : <Delta delta={headDelta} suffix={periodLabel(s.headcount.period)} />}
      </SummaryCard>
      <SummaryCard icon={UserPlus} tint="lavender" title="Onboarding" value={formatInt(s.onboarding.value)} testId="sum-onboarding" na={s.onboarding}>
        <Pill tone="lavender">{statusLabel(s.onboarding.status)}</Pill>
      </SummaryCard>
      <SummaryCard icon={UserMinus} tint="lavender" title="Offboarding" value={formatInt(s.offboarding.value)} testId="sum-offboarding" na={s.offboarding}>
        <Pill tone="blue">{statusLabel(s.offboarding.status)}</Pill>
      </SummaryCard>
      <SummaryCard icon={FileText} tint="blue" title="Expiring Documents" value={formatInt(s.expiring_documents.value)} testId="sum-expiring" na={s.expiring_documents}>
        <Pill tone="amber">{expiringLabel(s.expiring_documents.window_days)}</Pill>
      </SummaryCard>
      <SummaryCard icon={ShieldCheck} tint="lavender" title="Policy Acknowledgement" value={`${formatPct(s.policy_acknowledgement.pct)}%`} testId="sum-policy" na={s.policy_acknowledgement}>
        {s.policy_acknowledgement.delta_pp === null ? <NoDelta /> : <Delta delta={policyDelta} suffix="vs. last month" />}
      </SummaryCard>
    </div>
  )
}



function Delta({ delta, suffix, goodWhenDown = false }: { delta: { text: string; direction: 'up' | 'down' | 'flat' }; suffix: string; goodWhenDown?: boolean }) {
  const good = delta.direction === 'up' || (goodWhenDown && delta.direction === 'down') || delta.direction === 'flat'
  return (
    <span className="delta">
      {delta.direction !== 'flat' ? <span className={`tri tri-${delta.direction}${good ? ' tri-good' : ' tri-bad'}`} aria-hidden="true" /> : null}
      <span className={good ? 'delta-good' : 'delta-bad'}>{delta.text}</span> <span className="delta-suffix">{suffix}</span>
    </span>
  )
}

function StatusIcon({ index }: { index: number }) {
  if (index === 0) return <CircleCheck className="st st-done" size={20} aria-hidden="true" fill="#1fa355" stroke="#fff" />
  if (index === 1) return <span className="st st-open" aria-hidden="true" />
  return <span className="st st-idle" aria-hidden="true" />
}

function LifecycleCard({
  id,
  testId,
  icon,
  title,
  subtitle,
  action,
  block,
  centerLabel,
  size,
  stroke,
}: {
  id: string
  testId: string
  icon: LucideIcon
  title: string
  subtitle: string
  action: string
  block: DashboardModel['onboarding']
  centerLabel: string
  size: number
  stroke: number
}) {
  if (!block.available) {
    return (
      <section className="hr-card lifecycle-card" aria-labelledby={id} data-testid={testId} data-available="false">
        <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} id={id} />
        <div className="lifecycle-body lifecycle-body-na" style={{ minHeight: size }}>
          <NotAvailable title={unavailableTitle(block.reason)} reason={unavailableReason(block.reason)} minHeight={size} />
        </div>
      </section>
    )
  }
  const pct = clampPct(block.pct)
  return (
    <section className="hr-card lifecycle-card" aria-labelledby={id} data-testid={testId}>
      <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} id={id} />
      <div className="lifecycle-body">
        <Donut pct={pct} size={size} stroke={stroke} label={`${pct}% ${centerLabel}`}>
          <div className="donut-pct">{Math.round(pct)}%</div>
          <div className="donut-caption">{centerLabel}</div>
        </Donut>
        <div className="lifecycle-rows">
          <div className="lifecycle-total">{formatInt(block.total)} total</div>
          <ul>
            {lifecycleRows({ completed: block.completed ?? 0, in_progress: block.in_progress ?? 0, not_started: block.not_started ?? 0 }).map((row, i) => (
              <li key={row.label}>
                <StatusIcon index={i} />
                <span className="row-label">{row.label}</span>
                <span className="row-value">{formatInt(row.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const DIR_ICONS: Record<string, LucideIcon> = { full_time: UserRound, part_time: Timer, contractor: Briefcase, intern: GraduationCap }

function DirectoryCard({ directory }: { directory: DashboardModel['directory'] }) {
  return (
    <section className="hr-card directory-card" aria-labelledby="dir" data-testid="card-directory" data-available={directory.available ? undefined : 'false'}>
      <CardHeader icon={UsersRound} title="Employee Directory" subtitle="Company people overview" action="Go to Directory" actionTo="/directory" id="dir" />
      {directory.available ? (
        <div className="directory-body">
          <div className="directory-total">
            <UsersRound size={34} strokeWidth={1.5} aria-hidden="true" />
            <strong>{formatInt(directory.total)}</strong>
            <span>Employees</span>
          </div>
          <ul className="directory-rows">
            {directoryRows({ full_time: directory.full_time ?? 0, part_time: directory.part_time ?? 0, contractor: directory.contractor ?? 0, intern: directory.intern ?? 0 }).map((row) => {
              const Icon = DIR_ICONS[row.key] ?? UserRound
              return (
                <li key={row.key}>
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span className="row-label">{row.label}</span>
                  <span className="row-value">{formatInt(row.value)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="directory-body">
          <NotAvailable title={unavailableTitle(directory.reason)} reason={unavailableReason(directory.reason)} minHeight={128} />
        </div>
      )}
    </section>
  )
}

function AccountsCard({ accounts }: { accounts: NonNullable<DashboardModel['microsoft_accounts']> }) {
  return (
    <section className="hr-card accounts-card" aria-labelledby="accts" data-testid="card-accounts" data-available={accounts.available ? undefined : 'false'}>
      <CardHeader icon={UsersRound} title="Microsoft Accounts" subtitle="Synced people and who can sign in" action="Users and roles" actionTo="/settings?tab=users" id="accts" />
      {accounts.available ? (
        <div className="accounts-body">
          <ul className="accounts-rows">
            <li data-testid="accounts-synced">
              <span className="row-label">Synced from Microsoft</span>
              <span className="row-value">{formatInt(accounts.synced)}</span>
            </li>
            <li data-testid="accounts-active">
              <span className="row-label">Active users (Users and roles)</span>
              <span className="row-value">{formatInt(accounts.active_users)}</span>
            </li>
            <li data-testid="accounts-waiting">
              <span className="row-label">Not signed in yet</span>
              <span className="row-value">{formatInt(accounts.not_signed_in)}</span>
            </li>
          </ul>
          {accounts.by_role.length > 0 ? (
            <ul className="accounts-roles" aria-label="Active users by role">
              {accounts.by_role.map((r) => (
                <li key={r.role} data-testid={`accounts-role-${r.role}`}>
                  <span className="row-label">{r.role}</span>
                  <span className="row-value">{formatInt(r.count)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="accounts-body">
          <NotAvailable title={unavailableTitle(accounts.reason)} reason={unavailableReason(accounts.reason)} minHeight={128} />
        </div>
      )}
    </section>
  )
}

function CasesCard({ cases }: { cases: DashboardModel['hr_cases'] }) {
  const delta = formatDelta(cases.delta_pct, '%')
  return (
    <section className="hr-card cases-card" aria-labelledby="cases" data-testid="card-cases" data-available={cases.available ? undefined : 'false'}>
      <header className="card-header">
        <span className="tile tile-lavender" aria-hidden="true">
          <Headset size={24} strokeWidth={1.7} />
        </span>
        <div className="card-header-text">
          <h2 id="cases">Active HR Cases</h2>
          <p>Employee inquiries and requests requiring HR action</p>
        </div>
        <MutedAction label="View All Cases" />
      </header>
      {cases.available ? (
        <div className="cases-body">
          <Donut pct={cases.active === 0 ? 0 : 100} size={128} stroke={14} from="#1d9bf0" to="#8b5cf6" trackFrom="#d6e6ff" trackTo="#d6e6ff" label={`${cases.active ?? 0} active cases`}>
            <div className="donut-pct donut-pct-sm">{formatInt(cases.active)}</div>
            <div className="donut-caption">
              Active
              <br />
              Cases
            </div>
          </Donut>
          <ul className="priority-rows">
            <li>
              <span className="dot dot-red" aria-hidden="true" />
              <span className="row-label">High Priority</span>
              <span className="row-value">{formatInt(cases.high)}</span>
            </li>
            <li>
              <span className="dot dot-yellow" aria-hidden="true" />
              <span className="row-label">Medium Priority</span>
              <span className="row-value">{formatInt(cases.medium)}</span>
            </li>
            <li>
              <span className="dot dot-blue" aria-hidden="true" />
              <span className="row-label">Low Priority</span>
              <span className="row-value">{formatInt(cases.low)}</span>
            </li>
          </ul>
          <div className="resolution-panel">
            <Clock size={26} strokeWidth={1.6} aria-hidden="true" />
            <div className="resolution-text">
              <span className="resolution-title">Avg. Resolution Time</span>
              <strong>{resolutionDays(cases.avg_resolution_days)}</strong>
              {cases.avg_resolution_days === null ? (
                <NoDelta text="No resolved cases yet" />
              ) : cases.delta_pct === null ? (
                <NoDelta />
              ) : (
                <Delta delta={delta} suffix="vs. last month" goodWhenDown />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="cases-body cases-body-na">
          <NotAvailable title={unavailableTitle(cases.reason)} reason={unavailableReason(cases.reason)} minHeight={128} />
        </div>
      )}
    </section>
  )
}


function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" aria-busy="true" role="status">
      <span className="sr-only">Loading dashboard</span>
      <div className="summary-row">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="hr-card summary-card" key={i}>
            <Skeleton style={{ width: 46, height: 46, borderRadius: 12 }} />
            <div className="summary-body" style={{ gap: 8, display: 'grid' }}>
              <Skeleton style={{ width: '70%', height: 14 }} />
              <Skeleton style={{ width: '50%', height: 30 }} />
              <Skeleton style={{ width: '80%', height: 18 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="hr-grid">
        <div className="hr-left">
          <Skeleton className="skeleton-card" style={{ height: 235 }} />
          <Skeleton className="skeleton-card" style={{ height: 235 }} />
          <Skeleton className="skeleton-card" style={{ height: 205 }} />
          <Skeleton className="skeleton-card" style={{ height: 205 }} />
          <Skeleton className="skeleton-card hr-wide" style={{ height: 190 }} />
        </div>
        <Skeleton className="skeleton-card" style={{ height: 530 }} />
      </div>
    </div>
  )
}

