import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight, Cake, CalendarDays, Info, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/Avatar'
import { birthdayChip, holidayBlock, unavailableReason, unavailableTitle, type BlockState, type DashboardModel } from '@/lib/dashboardFormat'
import './hr-admin.css'

/** Building blocks of the dashboard look, shared by the HR dashboard and the personal dashboard. */

export function CardHeader({ icon: Icon, title, subtitle, action, actionTo, id }: { icon: LucideIcon; title: string; subtitle: string; action?: string; actionTo?: string; id: string }) {
  return (
    <header className="card-header">
      <span className="tile tile-lavender" aria-hidden="true">
        <Icon size={24} strokeWidth={1.7} />
      </span>
      <div className="card-header-text">
        <h2 id={id}>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action && actionTo ? <CardLink label={action} to={actionTo} /> : action ? <MutedAction label={action} /> : null}
    </header>
  )
}

/** A real link (the destination exists). Same look as the reference's blue "View ..." links. */
export function CardLink({ label, to }: { label: string; to: string }) {
  return (
    <Link to={to} className="card-link" data-testid="card-link">
      {label}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  )
}

/** Looks like a link in the reference, but there is no destination yet, so it is plain muted text (no dead button). */
export function MutedAction({ label, arrow = true }: { label: string; arrow?: boolean }) {
  return (
    <span className="muted-action" title="Coming soon">
      {label}
      {arrow ? <ArrowRight size={14} aria-hidden="true" /> : null}
    </span>
  )
}

/**
 * Honest stand-in for a block that has no numbers ("Not tracked yet" / "Temporarily unavailable"), with the server's reason.
 * It fills the same box (`minHeight`) as the content it replaces so the grid does not jump.
 */
export function NotAvailable({ title, reason, minHeight, testId }: { title: string; reason: string; minHeight: number; testId?: string }) {
  const style: CSSProperties = { minHeight }
  return (
    <div className="hr-na" style={style} data-testid={testId ?? 'not-available'} role="note">
      <Info size={20} strokeWidth={1.7} aria-hidden="true" />
      <div className="hr-na-text">
        <strong>{title}</strong>
        <span>{reason}</span>
      </div>
    </div>
  )
}

export function SummaryCard({
  icon: Icon,
  tint,
  title,
  value,
  children,
  testId,
  na,
}: {
  icon: LucideIcon
  tint: 'blue' | 'lavender'
  title: string
  value: string
  children: ReactNode
  testId: string
  /** The block's availability: when it is not available the card says so instead of showing numbers. */
  na?: BlockState
}) {
  const unavailable = na ? !na.available : false
  return (
    <section className={`hr-card summary-card${unavailable ? ' summary-card-na' : ''}`} data-testid={testId} data-available={unavailable ? 'false' : undefined}>
      <span className={`tile tile-${tint}`} aria-hidden="true">
        <Icon size={26} strokeWidth={1.6} />
      </span>
      <div className="summary-body">
        <h2>{title}</h2>
        {unavailable ? (
          <>
            <div className="summary-value summary-value-na">{unavailableTitle(na?.reason)}</div>
            <div className="summary-foot summary-foot-na" title={unavailableReason(na?.reason)}>
              {unavailableReason(na?.reason)}
            </div>
          </>
        ) : (
          <>
            <div className="summary-value">{value}</div>
            <div className="summary-foot">{children}</div>
          </>
        )}
      </div>
    </section>
  )
}

export function Pill({ tone, children }: { tone: 'lavender' | 'blue' | 'amber'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function UpcomingCard({
  birthdays,
  holidays,
  failed,
  notice,
}: {
  birthdays: DashboardModel['birthdays']
  holidays: DashboardModel['holidays']
  failed: string[]
  /** Replaces the two lists while they are loading, or when they could not be loaded. */
  notice?: ReactNode
}) {
  return (
    <aside className="upcoming-card" aria-labelledby="upcoming" data-testid="card-upcoming">
      <header className="upcoming-head">
        <span className="tile tile-glass" aria-hidden="true">
          <CalendarDays size={24} strokeWidth={1.6} />
        </span>
        <div>
          <h2 id="upcoming">Upcoming Holidays &amp; Birthdays</h2>
          <p>Upcoming celebrations and time off</p>
        </div>
      </header>
      <div className="upcoming-body">
        {notice ? (
          notice
        ) : (
          <>
        <h3 className="upcoming-section">
          <Cake size={22} strokeWidth={1.7} aria-hidden="true" />
          Upcoming Birthdays
        </h3>
        {birthdays.length > 0 ? (
          <ul className="birthday-list">
            {birthdays.map((b) => (
              <li key={`${b.name}-${b.date}`}>
                <Avatar name={b.name} initials={b.avatar_initials} size={46} />
                <div className="person">
                  <strong>{b.name}</strong>
                  <span>{b.team}</span>
                </div>
                <span className="date-chip">{birthdayChip(b.date)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="upcoming-empty" data-testid="birthdays-empty">
            {failed.includes('birthdays') ? 'Birthdays could not be computed just now.' : 'No birthdays in the next 30 days.'}
          </p>
        )}
        <hr className="upcoming-rule" />
        <h3 className="upcoming-section">
          <CalendarDays size={22} strokeWidth={1.7} aria-hidden="true" />
          Upcoming Holidays
        </h3>
        {holidays.length > 0 ? (
          <ul className="holiday-list">
            {holidays.map((h) => {
              const b = holidayBlock(h)
              return (
                <li key={`${b.month}-${b.day}-${b.name}`}>
                  <span className="date-block">
                    <span className="date-block-month">{b.month}</span>
                    <span className="date-block-day">{b.day}</span>
                  </span>
                  <div className="person">
                    <strong>{b.name}</strong>
                    <span>{b.type}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="upcoming-empty" data-testid="holidays-empty">
            {failed.includes('holidays') ? 'Holidays could not be computed just now.' : 'No company holidays in the next 30 days.'}
          </p>
        )}
          </>
        )}
      </div>
    </aside>
  )
}

export function HrSwoosh() {
  return (
    <svg className="hr-swoosh" viewBox="0 0 560 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hr-sw-a" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b7cf6" stopOpacity="0" />
          <stop offset="0.35" stopColor="#7a6cf0" stopOpacity="0.8" />
          <stop offset="1" stopColor="#2f86f0" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="hr-sw-b" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffc928" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffc928" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffc928" />
        </linearGradient>
      </defs>
      <path d="M0 100 C 150 108, 300 95, 400 70 C 460 54, 510 40, 560 34 L 560 62 C 500 64, 460 80, 400 92 C 300 108, 150 112, 0 100 Z" fill="url(#hr-sw-a)" />
      <path d="M440 62 C 490 46, 530 26, 560 6 L 560 30 C 530 38, 490 52, 440 62 Z" fill="url(#hr-sw-b)" />
    </svg>
  )
}
